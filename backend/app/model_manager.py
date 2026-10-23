"""Process-wide OmniVoice model singleton.

The model is loaded once at application startup (see ``main.lifespan``).
``model.generate()`` is not guaranteed to be thread-safe, so every call into
the model goes through a single lock.
"""

import threading
from pathlib import Path
from typing import Any, Optional, Union

import numpy as np

from app import config

PathLike = Union[str, Path]


def _resolve_dtype(name: str) -> Any:
    """Map a dtype name such as ``"float32"`` to the matching ``torch.dtype``."""
    import torch

    dtype = getattr(torch, name, None)
    if not isinstance(dtype, torch.dtype):
        raise ValueError(f"Unsupported OMNIVOICE_DTYPE: {name!r}")
    return dtype


def _to_numpy_audio(audio: Any) -> np.ndarray:
    """Normalise a generate() result to a 1-D numpy array (the first clip)."""
    if isinstance(audio, (list, tuple)):
        audio = audio[0]
    if hasattr(audio, "detach"):  # torch.Tensor
        audio = audio.detach().cpu().numpy()
    return np.asarray(audio)


class ModelManager:
    """Owns the single OmniVoice instance and serialises access to it."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model: Optional[Any] = None

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        """Load the model onto the configured device. Safe to call more than once."""
        if self._model is not None:
            return
        from omnivoice import OmniVoice

        dtype = _resolve_dtype(config.OMNIVOICE_DTYPE)
        with self._lock:
            if self._model is None:
                self._model = OmniVoice.from_pretrained(
                    config.OMNIVOICE_MODEL,
                    device_map=config.OMNIVOICE_DEVICE,
                    dtype=dtype,
                )

    def _require_model(self) -> Any:
        if self._model is None:
            raise RuntimeError("OmniVoice model is not loaded; call load() first.")
        return self._model

    def generate(
        self,
        text: str,
        *,
        ref_audio: Optional[PathLike] = None,
        ref_text: Optional[str] = None,
        voice_clone_prompt: Any = None,
        instruct: Optional[str] = None,
        num_step: int = 32,
        speed: float = 1.0,
        duration: Optional[float] = None,
    ) -> np.ndarray:
        """Synthesise ``text`` and return mono 24 kHz audio as a numpy array.

        Pass ``ref_audio`` (optionally with ``ref_text``) or ``voice_clone_prompt``
        for cloning, ``instruct`` for voice design, or none of these for auto voice.
        Optional arguments that are None or empty are omitted from the model call.
        """
        kwargs: dict[str, Any] = {"text": text, "num_step": num_step, "speed": speed}
        if ref_audio is not None:
            kwargs["ref_audio"] = str(ref_audio)
        if ref_text:
            kwargs["ref_text"] = ref_text
        if voice_clone_prompt is not None:
            kwargs["voice_clone_prompt"] = voice_clone_prompt
        if instruct:
            kwargs["instruct"] = instruct
        if duration is not None:
            kwargs["duration"] = duration

        with self._lock:
            model = self._require_model()
            audio = model.generate(**kwargs)
        return _to_numpy_audio(audio)

    def create_voice_prompt(self, ref_audio: PathLike, ref_text: Optional[str] = None) -> Any:
        """Encode a reference clip into a reusable VoiceClonePrompt (call ``.save()`` on it)."""
        kwargs: dict[str, Any] = {"ref_audio": str(ref_audio)}
        if ref_text:
            kwargs["ref_text"] = ref_text
        with self._lock:
            model = self._require_model()
            return model.create_voice_clone_prompt(**kwargs)

    @staticmethod
    def load_voice_prompt(path: PathLike) -> Any:
        """Load a VoiceClonePrompt previously written with ``prompt.save(path)``."""
        from omnivoice import VoiceClonePrompt

        return VoiceClonePrompt.load(str(path))


model_manager = ModelManager()
