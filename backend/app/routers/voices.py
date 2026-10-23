"""GET/DELETE /api/voices: list and remove saved reusable voice prompts."""

import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response

from app import config, schemas, storage

router = APIRouter()
voices_lock = threading.Lock()

DATA_DIR = Path(config.DATA_DIR)
VOICES_DIR = DATA_DIR / "voices"
VOICES_JSON = DATA_DIR / "voices.json"


def _public(voice: dict) -> dict:
    return {
        "id": voice.get("id"),
        "name": voice.get("name"),
        "created_at": voice.get("created_at"),
    }


@router.get("/api/voices", response_model=schemas.VoicesResponse)
def list_voices():
    data = storage.load_json(VOICES_JSON, {"voices": []})
    voices = data.get("voices", [])
    # Newest first; entries are appended chronologically.
    return {"voices": [_public(v) for v in reversed(voices)]}


@router.delete("/api/voices/{voice_id}", status_code=204)
def delete_voice(voice_id: str):
    with voices_lock:
        data = storage.load_json(VOICES_JSON, {"voices": []})
        voices = data.get("voices", [])
        remaining = [v for v in voices if v.get("id") != voice_id]
        if len(remaining) == len(voices):
            raise HTTPException(status_code=404, detail="voice not found")
        storage.save_json(VOICES_JSON, {"voices": remaining})

    # Only the id matched from voices.json reaches the filesystem.
    (VOICES_DIR / f"{voice_id}.pt").unlink(missing_ok=True)
    return Response(status_code=204)
