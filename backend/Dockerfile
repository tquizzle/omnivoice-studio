# OmniVoice Studio backend image.
#
# Build context is the REPO ROOT (see docker-compose.yml), so paths below are
# relative to the repo root:
#   docker build -f backend/Dockerfile .
#
# IMPORTANT: Apple Silicon MPS acceleration is NOT available inside Linux Docker
# containers. For GPU/MPS acceleration on a Mac, run this app as a native Python
# process (see README.md, "Run natively on macOS"). This image is intended for
# portability and CPU fallback, or for Linux hosts with NVIDIA GPUs (use a CUDA
# base image and set OMNIVOICE_DEVICE=cuda:0 for that).

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OMNIVOICE_MODEL=k2-fsa/OmniVoice \
    OMNIVOICE_DEVICE=cpu \
    OMNIVOICE_DTYPE=float32 \
    DATA_DIR=/data \
    HF_HOME=/data/hf-cache

# ffmpeg is needed for decoding the wide range of audio formats users upload.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

COPY backend/app /app/backend/app

# The FastAPI app serves ../frontend relative to /app/backend, i.e. /app/frontend.
COPY frontend /app/frontend

# Persistent state (voices, outputs, JSON metadata, model cache) lives in /data,
# which docker-compose mounts from ./data on the host.
RUN mkdir -p /data/voices /data/outputs /data/hf-cache

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
