"""GET/DELETE /api/history: list and remove generated clips."""

import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response

from app import config, schemas, storage

router = APIRouter()
history_lock = threading.Lock()

DATA_DIR = Path(config.DATA_DIR)
HISTORY_JSON = DATA_DIR / "history.json"
OUTPUT_DIR = Path(storage.OUTPUT_DIR)


def _public(item: dict) -> dict:
    return {
        "id": item.get("id"),
        "mode": item.get("mode"),
        "text": item.get("text"),
        "audio_url": item.get("audio_url"),
        "created_at": item.get("created_at"),
    }


@router.get("/api/history", response_model=schemas.HistoryResponse)
def list_history():
    data = storage.load_json(HISTORY_JSON, {"items": []})
    items = data.get("items", [])
    # Newest first; entries are appended chronologically.
    return {"items": [_public(i) for i in reversed(items)]}


@router.delete("/api/history/{item_id}", status_code=204)
def delete_history_item(item_id: str):
    with history_lock:
        data = storage.load_json(HISTORY_JSON, {"items": []})
        items = data.get("items", [])
        remaining = [i for i in items if i.get("id") != item_id]
        if len(remaining) == len(items):
            raise HTTPException(status_code=404, detail="history item not found")
        storage.save_json(HISTORY_JSON, {"items": remaining})

    # Only the id matched from history.json reaches the filesystem.
    (OUTPUT_DIR / f"{item_id}.wav").unlink(missing_ok=True)
    return Response(status_code=204)
