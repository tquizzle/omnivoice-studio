# Technical guide

The full configuration reference, HTTP API, and troubleshooting guide for OmniVoice Studio.
See the [repo root README](../README.md) for the feature overview and quickstart.

It supports three ways of producing speech, plus a library:

- **Clone**: speak text in a voice taken from a reference clip. You can upload a new clip or pick a saved voice. The reference transcript is optional, because Whisper transcribes the clip automatically when it is left blank.
- **Design**: describe the voice with controls for gender, age, pitch, whisper, accent, and dialect. The app composes these into an instruction string for the model.
- **Auto**: no reference audio and no description. The model picks a voice.
- **Library**: saved voices and a history of everything you have generated.

> **Screenshot placeholder:** add `docs/screenshot.png` and embed it here once the UI is final.

---

## Requirements

- **Native run (recommended):** macOS on Apple Silicon, Python 3.12 (to match the Docker image), and ffmpeg (`brew install ffmpeg`).
- **Docker run:** Docker Desktop or Docker Engine with Compose v2.

## Project layout

```
.
  backend/
    app/            FastAPI app: main, config, model_manager, schemas, storage, routers/
    requirements.txt
    Dockerfile
    README.md       this file
  frontend/         index.html, style.css, app.js (no build step)
  docker-compose.yml
  .env.example
  README.md
  data/             created at runtime: voices/, outputs/, voices.json, history.json
```

---

## Run mode 1: native on macOS (recommended, MPS acceleration)

Docker on macOS runs inside a Linux VM, and Linux containers cannot reach Apple's Metal (MPS) GPU. Running natively is the only way to get hardware acceleration on a Mac. Use this mode for day-to-day work.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
DATA_DIR=./data OMNIVOICE_DEVICE=mps uvicorn app.main:app --reload --app-dir backend --host 0.0.0.0 --port 8000
```

Then open **http://localhost:8000**.

Notes:

- The model loads once at startup, so the page only responds after the log shows the model is ready. The first start also downloads the model weights from Hugging Face, which can take a while.
- The native process reads its settings from the environment variables on the command line. It does not read `.env`. Only Docker Compose reads `.env`.
- `DATA_DIR=./data` keeps voices and history inside the project. The config default (`/data`) is meant for containers.
- `--host 0.0.0.0` makes the app reachable from other devices on your LAN. To restrict it to this Mac, use `--host 127.0.0.1`.
- Drop `--reload` for steady use. It exists for development.
- To confirm MPS is available to PyTorch, run `python -c "import torch; print(torch.backends.mps.is_available())"`.
- Stop the server with Ctrl+C.

## Run mode 2: Docker (CPU, portable)

This mode runs the same app in a container with CPU inference. Use it on Linux hosts, on machines without Apple Silicon, or when you want a self-contained deployment. It is noticeably slower than native MPS on a Mac.

```bash
cp .env.example .env
docker compose up -d
```

Then open **http://localhost:8000**.

Useful commands:

```bash
docker compose logs -f omnivoice-webui   # follow logs
docker compose down                      # stop and remove the container (data is kept)
docker compose up -d --build             # rebuild after changing backend code or requirements
```

Details:

- `./data` on the host is mounted at `/data` in the container, so voices, generated audio, and history survive rebuilds and restarts.
- `./frontend` is mounted read-only into the container. Edits to the HTML, CSS, or JS show up on a browser refresh without rebuilding. Backend changes need `--build`.
- The container runs on CPU only. Apple Silicon MPS is not available inside Linux containers. This compose file does not configure NVIDIA GPU passthrough. On a Linux host with an NVIDIA GPU, you would need to add GPU reservations and set `OMNIVOICE_DEVICE=cuda:0` yourself.
- `restart: unless-stopped` brings the container back after a reboot, unless you stopped it explicitly.

---

## Configuration

Settings are environment variables. `config.py` supplies these defaults when a variable is unset:

| Variable | Default in code | Docker `.env.example` | Meaning |
|---|---|---|---|
| `OMNIVOICE_MODEL` | `k2-fsa/OmniVoice` | `k2-fsa/OmniVoice` | Hugging Face model repo to load |
| `OMNIVOICE_DEVICE` | `mps` | `cpu` | Inference device: `mps`, `cpu`, `cuda:0`, or `xpu` |
| `OMNIVOICE_DTYPE` | `float32` | `float32` | Torch dtype name, resolved with `getattr(torch, ...)`. `float32` is safest on `mps` and `cpu` |
| `DATA_DIR` | `/data` | `/data` | Root for `voices/`, `outputs/`, `voices.json`, and `history.json` |

Native runs override `DATA_DIR` and `OMNIVOICE_DEVICE` on the command line. Docker runs take them from `.env`, and `docker-compose.yml` pins `DATA_DIR=/data`.

## Data on disk

Everything lives under `DATA_DIR` (`./data` on the host in both modes):

```
data/
  voices/<voice_id>.pt     reusable voice prompts (saved from clone mode)
  outputs/<id>.wav         generated audio, served at /audio/
  voices.json              saved voice metadata
  history.json             generation history, newest first
```

No database is used. To back up, copy the `data/` folder. To reset, stop the app and delete `data/`.

---

## HTTP API

All endpoints are JSON unless noted. Errors use the shape `{"detail": "..."}`. FastAPI also serves interactive docs at `/docs`.

### `POST /api/generate`

Generates speech and records it in history. The request is `multipart/form-data`.

| Field | Type | Required | Description |
|---|---|---|---|
| `mode` | string | yes | `clone`, `design`, or `auto` |
| `text` | string | yes | Text to speak |
| `ref_audio` | file | no | Reference audio. Used when `mode=clone` and no `voice_id` is given |
| `ref_text` | string | no | Transcript of the reference clip. If omitted, Whisper transcribes it |
| `voice_id` | string | no | ID of a saved voice. Used when `mode=clone` |
| `instruct` | string | no | Voice description. Used when `mode=design` |
| `num_step` | int | no | Diffusion steps. Default `32`. `16` is faster with some quality loss |
| `speed` | float | no | Speaking speed. Default `1.0` |
| `duration` | float | no | Target length in seconds. Overrides `speed` when set |
| `save_voice_name` | string | no | With `mode=clone` and `ref_audio`, also saves a reusable voice under this name |

Rules:

- `mode=clone` requires either `ref_audio` or `voice_id`. If neither is given, the response is `400`.
- If both `voice_id` and `ref_audio` are sent, `voice_id` is used and `ref_audio` is ignored.
- `save_voice_name` only applies when `ref_audio` is uploaded. Otherwise `saved_voice_id` is `null`.
- `instruct` is only used in `design` mode.
- Validation failures return `422` with `{"detail": "..."}`.

Response `200`:

```json
{
  "id": "3f6c1a2e-8b4d-4e1a-9c2f-5d7e9a0b1c2d",
  "mode": "clone",
  "text": "Hello from my cloned voice",
  "audio_url": "/audio/3f6c1a2e-8b4d-4e1a-9c2f-5d7e9a0b1c2d.wav",
  "created_at": "2026-10-22T12:00:00Z",
  "saved_voice_id": "9b2e4f10-7c3a-4d8e-a1b2-c3d4e5f60718"
}
```

`saved_voice_id` is `null` when no voice was saved.

Examples:

```bash
# Clone from an uploaded clip and save it as a reusable voice
curl -X POST http://localhost:8000/api/generate \
  -F mode=clone \
  -F text="Hello from my cloned voice" \
  -F ref_audio=@reference.wav \
  -F ref_text="Transcript of the reference clip" \
  -F save_voice_name="My Voice"

# Clone using a previously saved voice
curl -X POST http://localhost:8000/api/generate \
  -F mode=clone \
  -F voice_id=9b2e4f10-7c3a-4d8e-a1b2-c3d4e5f60718 \
  -F text="Another line in the same voice"

# Voice design
curl -X POST http://localhost:8000/api/generate \
  -F mode=design \
  -F text="Good morning" \
  -F instruct="female, low pitch, british accent"

# Auto voice
curl -X POST http://localhost:8000/api/generate \
  -F mode=auto \
  -F text="Good morning" \
  -F num_step=16
```

### `GET /api/voices`

Returns saved voices.

```json
{"voices": [{"id": "uuid", "name": "My Voice", "created_at": "2026-10-22T12:00:00Z"}]}
```

### `DELETE /api/voices/{voice_id}`

Removes the voice from `voices.json` and deletes `voices/<voice_id>.pt`. Returns `204` with no body.

### `GET /api/history`

Returns generation history, newest first.

```json
{"items": [{"id": "uuid", "mode": "clone", "text": "...", "audio_url": "/audio/<id>.wav", "created_at": "2026-10-22T12:00:00Z"}]}
```

### `DELETE /api/history/{item_id}`

Removes the entry from `history.json` and deletes `outputs/<item_id>.wav`. Returns `204` with no body.

### Static audio and UI

- `GET /audio/<id>.wav` serves generated audio from `DATA_DIR/outputs`.
- `GET /` serves the web UI from `frontend/`.

Quick check from the command line:

```bash
curl http://localhost:8000/api/voices
curl http://localhost:8000/api/history
```

---

## Security: personal and LAN use only

This app has **no authentication**, and CORS allows all origins. Anyone who can reach the port can generate audio, read the history, and delete saved voices. It is built for a personal machine or a trusted home network.

Do not port-forward it to the internet. If you need access from outside your LAN, put it behind access control:

- **Cloudflare Tunnel with Cloudflare Access** (what I'd recommend if you already run a tunnel). Point a hostname at `http://localhost:8000` (or the container address if the tunnel runs in Docker), then add an Access application with an allow policy for your own identity. Requests are then authenticated before they reach the app.
- **An existing reverse proxy** with auth (basic auth, OAuth proxy, or similar) in front of port 8000.
- Keep the port bound to localhost (`--host 127.0.0.1` for native runs) if only local access is needed.

Only clone voices you have permission to use.

## Troubleshooting

- **`docker compose up` fails with a missing `.env` error:** run `cp .env.example .env` first.
- **Native start fails with a permission error on `/data`:** you ran without `DATA_DIR=./data`. Use the full command from Run mode 1.
- **Generation is very slow:** you are on the CPU path. On a Mac, run natively with `OMNIVOICE_DEVICE=mps`. Check MPS availability with the `torch.backends.mps.is_available()` command above.
- **Page does not load right after starting:** the model is still loading. Wait for the startup log line, then refresh.
- **Frontend changes not showing in Docker:** hard-refresh the browser. If you changed `backend/`, run `docker compose up -d --build`.
