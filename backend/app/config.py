"""Runtime configuration, read once from environment variables."""

import os
from pathlib import Path


def _env(name: str, default: str) -> str:
    """Return the stripped env var, or ``default`` when unset or blank."""
    value = os.environ.get(name, "").strip()
    return value or default


# Hugging Face repo id (or local path) passed to OmniVoice.from_pretrained().
OMNIVOICE_MODEL: str = _env("OMNIVOICE_MODEL", "k2-fsa/OmniVoice")

# torch device string: "mps" (Apple Silicon), "cuda:0", "cpu", "xpu", ...
OMNIVOICE_DEVICE: str = _env("OMNIVOICE_DEVICE", "mps")

# Name of a torch dtype, resolved with getattr(torch, name): float32, float16, bfloat16.
OMNIVOICE_DTYPE: str = _env("OMNIVOICE_DTYPE", "float32")

# Root for persistent data: contains voices/, outputs/, voices.json, history.json.
DATA_DIR: Path = Path(_env("DATA_DIR", "/data")).expanduser().resolve()
