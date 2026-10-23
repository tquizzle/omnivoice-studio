"""Filesystem and JSON-metadata helpers.

Layout under ``config.DATA_DIR``::

    voices/<voice_id>.pt     saved VoiceClonePrompt files
    outputs/<item_id>.wav    generated audio
    voices.json              list of saved voice metadata
    history.json             list of generation history entries
"""

import copy
import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Union

from app import config

PathLike = Union[str, os.PathLike]

DATA_DIR: Path = config.DATA_DIR
VOICES_DIR: Path = DATA_DIR / "voices"
OUTPUT_DIR: Path = DATA_DIR / "outputs"
VOICES_JSON: Path = DATA_DIR / "voices.json"
HISTORY_JSON: Path = DATA_DIR / "history.json"

# Serialises read-modify-write cycles on the JSON files. Sync route handlers
# run in a thread pool, so two requests can otherwise interleave.
store_lock = threading.RLock()


def ensure_dirs() -> None:
    """Create the data directories if they do not exist yet."""
    for directory in (DATA_DIR, VOICES_DIR, OUTPUT_DIR):
        directory.mkdir(parents=True, exist_ok=True)


def new_id() -> str:
    """Return a new random UUID4 string."""
    return str(uuid.uuid4())


def utc_now_iso() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()


def load_json(path: PathLike, default: Any) -> Any:
    """Load JSON from ``path``, or return a copy of ``default`` if the file is missing."""
    path = Path(path)
    if not path.exists():
        return copy.deepcopy(default)
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: PathLike, data: Any) -> None:
    """Write ``data`` as JSON to ``path`` atomically (temp file, then rename)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(path.name + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp_path, path)


def voice_prompt_path(voice_id: str) -> Path:
    """Path of the saved VoiceClonePrompt file for ``voice_id``."""
    return VOICES_DIR / f"{voice_id}.pt"


def output_wav_path(item_id: str) -> Path:
    """Path of the generated WAV file for history item ``item_id``."""
    return OUTPUT_DIR / f"{item_id}.wav"
