"""POST /api/generate: synthesize speech in clone, design, or auto mode."""

import logging
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import soundfile as sf
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from omnivoice import VoiceClonePrompt

from app import config, schemas, storage
from app.model_manager import model_manager
from app.routers.history import history_lock
from app.routers.voices import voices_lock

router = APIRouter()
log = logging.getLogger("omnivoice.generate")

SAMPLE_RATE = 24000
VALID_MODES = ("clone", "design", "auto")
DEFAULT_NUM_STEP = 32
DEFAULT_SPEED = 1.0

DATA_DIR = Path(config.DATA_DIR)
VOICES_DIR = DATA_DIR / "voices"
VOICES_JSON = DATA_DIR / "voices.json"
HISTORY_JSON = DATA_DIR / "history.json"
OUTPUT_DIR = Path(storage.OUTPUT_DIR)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: Optional[str]) -> Optional[str]:
    """Strip a form string; empty or whitespace-only becomes None."""
    if value is None:
        return None
    value = value.strip()
    return value or None


def _parse_int(raw: Optional[str], name: str, default: Optional[int]) -> Optional[int]:
    value = _clean(raw)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"'{name}' must be an integer") from None


def _parse_float(raw: Optional[str], name: str, default: Optional[float]) -> Optional[float]:
    value = _clean(raw)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"'{name}' must be a number") from None


def _find_voice(voice_id: str) -> Optional[dict]:
    data = storage.load_json(VOICES_JSON, {"voices": []})
    for voice in data.get("voices", []):
        if voice.get("id") == voice_id:
            return voice
    return None


def _load_voice_prompt(voice_id: str) -> VoiceClonePrompt:
    if _find_voice(voice_id) is None:
        raise HTTPException(status_code=404, detail="voice not found")
    prompt_path = VOICES_DIR / f"{voice_id}.pt"
    if not prompt_path.is_file():
        raise HTTPException(status_code=404, detail="voice prompt file is missing")
    return VoiceClonePrompt.load(str(prompt_path))


def _save_upload(upload: UploadFile, dest_dir: Path) -> Path:
    """Write the uploaded reference audio into a temp directory and return its path."""
    raw_suffix = Path(upload.filename or "").suffix.lower()
    suffix = raw_suffix if raw_suffix[1:].isalnum() and len(raw_suffix) <= 8 else ".wav"
    dest = dest_dir / f"reference{suffix}"
    with dest.open("wb") as out:
        shutil.copyfileobj(upload.file, out)
    if dest.stat().st_size == 0:
        raise HTTPException(status_code=422, detail="ref_audio is empty")
    return dest


@router.post("/api/generate", response_model=schemas.GenerateResponse)
def generate(
    mode: str = Form(...),
    text: str = Form(...),
    ref_audio: Optional[UploadFile] = File(None),
    ref_text: Optional[str] = Form(None),
    voice_id: Optional[str] = Form(None),
    instruct: Optional[str] = Form(None),
    num_step: Optional[str] = Form(None),
    speed: Optional[str] = Form(None),
    duration: Optional[str] = Form(None),
    save_voice_name: Optional[str] = Form(None),
):
    # Declared as a plain `def` so FastAPI runs it in a threadpool: the model
    # call is blocking and must not stall the event loop.
    mode = (mode or "").strip().lower()
    if mode not in VALID_MODES:
        raise HTTPException(status_code=422, detail=f"'mode' must be one of: {', '.join(VALID_MODES)}")

    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="'text' must not be empty")

    num_step_v = _parse_int(num_step, "num_step", DEFAULT_NUM_STEP)
    speed_v = _parse_float(speed, "speed", DEFAULT_SPEED)
    duration_v = _parse_float(duration, "duration", None)
    if num_step_v < 1:
        raise HTTPException(status_code=422, detail="'num_step' must be at least 1")
    if speed_v <= 0:
        raise HTTPException(status_code=422, detail="'speed' must be greater than 0")
    if duration_v is not None and duration_v <= 0:
        raise HTTPException(status_code=422, detail="'duration' must be greater than 0")

    ref_text_v = _clean(ref_text)
    instruct_v = _clean(instruct)
    voice_id_v = _clean(voice_id)
    save_name = _clean(save_voice_name)
    has_ref = ref_audio is not None and bool(ref_audio.filename)

    if mode == "clone" and not has_ref and voice_id_v is None:
        raise HTTPException(status_code=400, detail="clone mode requires ref_audio or voice_id")

    gen_kwargs: dict[str, Any] = {"text": text, "num_step": num_step_v, "speed": speed_v}
    if duration_v is not None:
        gen_kwargs["duration"] = duration_v

    prompt_to_save = None
    work_dir = Path(tempfile.mkdtemp(prefix="omnivoice-"))
    try:
        if mode == "clone":
            if voice_id_v is not None:
                gen_kwargs["voice_clone_prompt"] = _load_voice_prompt(voice_id_v)
            else:
                ref_path = _save_upload(ref_audio, work_dir)
                if save_name is not None:
                    # Build a reusable prompt once and generate from it, so the
                    # saved voice is exactly the one that produced this clip.
                    prompt_to_save = model_manager.create_voice_prompt(
                        ref_audio=str(ref_path), ref_text=ref_text_v
                    )
                    gen_kwargs["voice_clone_prompt"] = prompt_to_save
                else:
                    gen_kwargs["ref_audio"] = str(ref_path)
                    if ref_text_v is not None:
                        gen_kwargs["ref_text"] = ref_text_v
        elif mode == "design":
            if instruct_v is not None:
                gen_kwargs["instruct"] = instruct_v

        try:
            audio = model_manager.generate(**gen_kwargs)
        except HTTPException:
            raise
        except Exception as exc:
            # Full traceback goes to the server log (uvicorn console); the client
            # only gets a short, readable message via HTTPException.detail.
            log.exception(
                "generate() failed — mode=%s instruct=%r ref_text=%r kwargs_keys=%s",
                mode, instruct_v, ref_text_v, sorted(gen_kwargs.keys()),
            )
            raise HTTPException(status_code=500, detail=f"generation failed: {exc}") from exc
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("unexpected error in /api/generate (mode=%s)", mode)
        raise HTTPException(status_code=500, detail=f"generation failed: {exc}") from exc
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    # model_manager.generate returns a single mono ndarray; tolerate a list too.
    if isinstance(audio, (list, tuple)):
        audio = audio[0]

    item_id = str(uuid.uuid4())
    created_at = _now_iso()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    sf.write(str(OUTPUT_DIR / f"{item_id}.wav"), audio, SAMPLE_RATE)

    saved_voice_id = None
    if prompt_to_save is not None and save_name is not None:
        saved_voice_id = str(uuid.uuid4())
        VOICES_DIR.mkdir(parents=True, exist_ok=True)
        prompt_to_save.save(str(VOICES_DIR / f"{saved_voice_id}.pt"))
        with voices_lock:
            data = storage.load_json(VOICES_JSON, {"voices": []})
            data.setdefault("voices", []).append(
                {"id": saved_voice_id, "name": save_name, "created_at": created_at}
            )
            storage.save_json(VOICES_JSON, data)

    entry = {
        "id": item_id,
        "mode": mode,
        "text": text,
        "audio_url": f"/audio/{item_id}.wav",
        "created_at": created_at,
    }
    with history_lock:
        data = storage.load_json(HISTORY_JSON, {"items": []})
        data.setdefault("items", []).append(entry)
        storage.save_json(HISTORY_JSON, data)

    return {**entry, "saved_voice_id": saved_voice_id}
