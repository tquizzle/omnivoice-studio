"""GET /api/status: whether the OmniVoice model is loaded, and on what device.

The app's lifespan currently blocks startup until the model finishes loading
(see ``main.lifespan``), so in practice this always reports "ready" once the
server answers requests at all. It's still exposed as a real status check
(not a static value) so the frontend keeps working correctly if that
blocking behavior ever changes, and so the header always reflects the
actual configured device/model rather than a guess.
"""

from fastapi import APIRouter

from app import config, schemas
from app.model_manager import model_manager

router = APIRouter()


@router.get("/api/status", response_model=schemas.StatusResponse)
def get_status():
    return {
        "status": "ready" if model_manager.is_loaded else "loading",
        "model": config.OMNIVOICE_MODEL,
        "device": config.OMNIVOICE_DEVICE,
        "dtype": config.OMNIVOICE_DTYPE,
    }
