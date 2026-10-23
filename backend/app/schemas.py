"""Pydantic response models matching the JSON contract in SPEC.md section 2."""

from typing import Literal, Optional

from pydantic import BaseModel

GenerateMode = Literal["clone", "design", "auto"]


class GenerateResponse(BaseModel):
    id: str
    mode: GenerateMode
    text: str
    audio_url: str
    created_at: str
    saved_voice_id: Optional[str] = None


class VoiceOut(BaseModel):
    id: str
    name: str
    created_at: str


class VoicesResponse(BaseModel):
    voices: list[VoiceOut]


class HistoryItemOut(BaseModel):
    id: str
    mode: GenerateMode
    text: str
    audio_url: str
    created_at: str


class HistoryResponse(BaseModel):
    items: list[HistoryItemOut]
