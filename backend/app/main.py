"""FastAPI application entry point.

Run with: ``uvicorn app.main:app --app-dir backend`` (native) or
``uvicorn app.main:app`` from inside ``backend/`` (Docker).
"""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import storage
from app.model_manager import model_manager
from app.routers import generate, history, status, voices


def _resolve_frontend_dir() -> Path:
    """Locate the ``frontend/`` directory for both the repo layout and the Docker image.

    Repo layout:  <repo>/backend/app/main.py  -> <repo>/frontend
    Docker image: /app/app/main.py            -> /app/frontend
    """
    backend_dir = Path(__file__).resolve().parent.parent
    for candidate in (backend_dir / "frontend", backend_dir.parent / "frontend"):
        if (candidate / "index.html").is_file():
            return candidate
    raise RuntimeError(
        "Could not find the frontend directory (expected a folder containing index.html "
        f"next to or above {backend_dir})."
    )


FRONTEND_DIR: Path = _resolve_frontend_dir()

# StaticFiles validates its directory when constructed, so create the data dirs first.
storage.ensure_dirs()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    storage.ensure_dirs()
    # Model load is slow and blocking; run it in a worker thread so the event loop stays free.
    await asyncio.to_thread(model_manager.load)
    yield


app = FastAPI(
    title="OmniVoice Studio",
    version="1.0.0",
    lifespan=lifespan,
)

# LAN tool with no auth: allow every origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(generate.router)
app.include_router(voices.router)
app.include_router(history.router)
app.include_router(status.router)

app.mount("/audio", StaticFiles(directory=str(storage.OUTPUT_DIR)), name="audio")

# Mounted last: "/" is a catch-all for the static frontend and must not shadow the API.
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
