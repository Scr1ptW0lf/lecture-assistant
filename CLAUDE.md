# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A fully local, offline-first audio transcription and AI assistant ("Scribe"). Captures system audio output (loopback — not microphone), transcribes in real-time using Whisper, alerts when the user's name is spoken, generates cumulative AI summaries every 2 minutes, and answers questions grounded in an uploaded PDF via RAG. Supports lectures, meetings, video playback, podcasts, and general recordings.

**No external API calls at runtime. Everything runs on the local machine.**

## How to run

```powershell
# Start the backend (serves frontend at http://localhost:8000)
.venv\Scripts\python.exe main.py

# Frontend dev server (hot reload, proxies to :8000)
cd frontend
C:\Program Files\nodejs\npm.cmd run dev   # use npm.cmd not npm (PS execution policy)

# Rebuild frontend after changes
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH; Set-Location frontend; & "C:\Program Files\nodejs\npm.cmd" run build
```

**Note:** Run `ollama serve` first if Ollama isn't running as a background service. `TranscriptionEngine` can be reloaded at runtime via `POST /api/reinitialize` (calls `TranscriptionEngine.reset()` then `load()`); no restart needed for Whisper model changes.

## Architecture

```
System audio output (loopback)
  → backend/audio.py          (pyaudiowpatch WASAPI on Windows; sounddevice on macOS/Linux)
  → queue.Queue               (thread-safe bridge from audio callback to asyncio)
  → backend/transcription.py  (WhisperLiveKit AudioProcessor, pcm_input=True, LocalAgreement policy)
  → backend/name_detector.py  (exact + difflib fuzzy match)
  → WebSocket /ws/transcribe  (full-state-replace protocol)
      summary_loop()          (fires Ollama summary every 120 s via all_transcript_lines)
  → React frontend            (TranscriptPanel, QAPanel, browser Notification API)

PDF upload → backend/rag.py   (PyMuPDF → ChromaDB, sentence-transformers embeddings)
Question   → /api/qa          (ChromaDB retrieval + Ollama llama3.2:3b → SSE stream)
```

## Two hardware modes

Set via `MODE` in `.env`:

| Mode | Whisper model | LLM / RAG | RAM |
|------|--------------|-----------|-----|
| `lite` | tiny, CPU | none | ~1 GB |
| `full` | base, CUDA | Ollama llama3.2:3b + ChromaDB | ~6 GB |

The FastAPI routers for `/api/qa` and `/api/ingest` are only registered when `MODE=full`. `backend/config.py` applies sensible defaults automatically (e.g. `tiny` when mode is `lite`, `float16` when device is `cuda`).

## WhisperLiveKit integration

`WhisperLiveKit/` is a **vendored local clone** installed as an editable package (`pip install -e WhisperLiveKit/`). Do not install it from PyPI.

Key design decisions:
- `backend_policy="localagreement"` — LocalAgreement (not SimulStreaming). SimulStreaming's `get_buffer()` returns empty text for non-auto languages, so the live buffer preview would never appear.
- `pcm_input=True` — skips FFmpeg; we feed raw s16le bytes converted from float32 loopback audio.
- `vac=True` — Silero VAD gates audio to the transcription queue; reduces hallucination on silence.
- `TranscriptionEngine` is a **process-level singleton** (double-checked locking). `make_processor()` returns a fresh `AudioProcessor` per WebSocket session wrapping the shared engine. To reload with new settings, call `TranscriptionEngine.reset()` first — this clears `_instance` and `_initialized` so the next constructor call runs `_do_init`. `backend/transcription.load()` does this automatically.

The `results_formatter()` async generator in `AudioProcessor` yields `FrontData` objects every 50 ms when state changes. `FrontData.to_dict()["lines"]` includes **both** committed segments (from `validated_segments`) and the current in-progress segment (from `current_line_tokens`). Lines only move to `validated_segments` after a **>5 second silence** (`MIN_DURATION_REAL_SILENCE = 5` in `audio_processor.py`). During normal continuous speech, the entire session accumulates as a single growing segment.

**Paragraph splitting workaround:** Because WhisperLiveKit emits at most one committed segment per 5-second silence, `send_results()` in `ws_transcribe.py` calls `_split_sentences()` to break each segment's text into chunks of up to 4 sentences (≤40 words) before sending to the frontend. This gives the frontend enough lines to group into visual paragraphs.

## WebSocket protocol

Client → server (on connect, one message only):
```json
{ "student_name": "Aidan", "device_index": -1, "source": "textbook.pdf", "content_type": "lecture", "user_context": "COMP3900 algorithms midterm review" }
```
`source` is optional — omit or `null` to disable textbook RAG. `content_type` is one of `lecture | meeting | video | podcast | general` (defaults to `general`). `user_context` is a free-text string for grounding the AI summary/answers (optional).

Client → server (after connect, on demand):
```json
{ "type": "request_summary" }
```
Triggers an immediate on-demand summary outside the 2-minute cycle.

Server → client:
```json
{ "type": "state", "lines": [{"start": "0:00:01.23", "end": "0:00:03.45", "text": "...", "name_detected": false}], "buffer": "current hypothesis...", "new_name_alerts": [] }
{ "type": "summary", "id": "summary-1", "token": "...", "done": false }
{ "type": "summary", "id": "summary-1", "token": "", "done": true }
{ "type": "status", "message": "Transcription started" }
{ "type": "error", "message": "..." }
```

`lines` is the **complete current line list** (not a diff). Each line includes `end` (segment end timestamp). The backend splits long segments into up to 4-sentence lines. The frontend groups every 3 lines into a visual paragraph.

`summary` messages stream a cumulative Ollama summary every `SUMMARY_INTERVAL_SECONDS` (120 s) or on demand. The frontend accumulates tokens keyed by `id` and displays only the latest summary in the Live Summary pane. The `all_transcript_lines` accumulator is a list defined in the outer `transcribe_ws` scope and shared by closure between `send_results` (appender) and `summary_loop`/the on-demand handler (readers). Do not redeclare it inside any inner function.

The `clearedIds` pattern on the frontend: when the user clicks Clear, the current line IDs are added to a `Set` ref. The `state` message handler filters out any line whose `start` is in that set, so cleared lines never re-appear even though the server keeps sending full state.

The main WebSocket handler blocks on `websocket.receive()` to detect the client close frame. When the client disconnects, `feed_task`, `results_task`, and `summary_task` are cancelled and `audio_processor.cleanup()` is called.

Frontend reconnects after 3 s on close and re-sends the init message.

## Runtime settings API

`backend/routers/settings.py` — registered in both `lite` and `full` modes:

- `GET /api/settings` — returns `whisper_model`, `whisper_device`, `whisper_compute_type`, `ollama_model`, `ollama_num_gpu`, `mode`
- `POST /api/settings` — validates, mutates the live `settings` singleton, and writes to `.env`
- `POST /api/reinitialize` — calls `TranscriptionEngine.reset()` + `transcription.load()` in a thread executor; takes several seconds while Whisper reloads. Disconnect and reconnect after to get a new `AudioProcessor` on the new engine.
- `GET /api/ollama/models` — proxies `GET /api/tags` from Ollama and returns locally pulled model names; returns `{"models": []}` if Ollama is unreachable

The ⚙ button in the top bar opens `SettingsModal`, which exposes: Whisper model (tiny/base/small), Ollama model (dropdown from `/api/ollama/models`), Ollama device (GPU/CPU toggle). **Save** writes `.env` only. **Save & Reinitialize** writes `.env` and calls `/api/reinitialize`.

Ollama GPU/CPU is controlled via `OLLAMA_NUM_GPU`: `-1` sends `{"num_gpu": 999}` (all layers to GPU), `0` sends `{"num_gpu": 0}` (CPU). Always sent explicitly so Ollama reloads the model on device change rather than reusing a cached session.

## Cross-platform audio

| OS | Library | Notes |
|----|---------|-------|
| Windows | `pyaudiowpatch` | WASAPI loopback, auto-detects default output |
| macOS | `sounddevice` | Needs BlackHole virtual device installed |
| Linux | `sounddevice` | Select `.monitor` device from PulseAudio/PipeWire |

`GET /api/devices` calls `list_loopback_devices()` so the UI can show a device picker.

**WASAPI auto-detect** uses a three-tier match against the default output device name: exact → substring → first available loopback. The `is_recommended` flag in the device list uses the same logic. This handles cases where the loopback device name doesn't exactly match the output device name.

## RAG (full mode)

ChromaDB collection: `"textbook"`, cosine similarity, 384-dim embeddings (`all-MiniLM-L6-v2`).
Chunk IDs: `"{filename}::chunk::{index}"` — deterministic, so re-uploading the same PDF is a safe upsert.
`chroma_path` defaults to `%LOCALAPPDATA%\lecture-assistant\chroma_db` on Windows to avoid OneDrive SQLite lock issues.
Chunk size: 1000 chars, overlap: 150 chars, top-k: 6.

**Multiple PDFs are supported.** Each PDF is stored with `{"source": filename}` metadata. The UI shows a dropdown to select the active textbook; `source=null` disables RAG and uses general knowledge only. The `retrieve()` method accepts an optional `source` parameter and filters ChromaDB with a `where` clause.

RAG endpoints:
- `POST /api/ingest` — upload a PDF; returns `{chunks_stored, filename}`
- `GET /api/rag/sources` — list all uploaded PDF filenames
- `GET /api/rag/status` — `{chunks_stored, has_textbook}`
- `DELETE /api/rag/sources` — delete all chunks from ChromaDB; returns `{deleted: N}`

The LLM prompt uses "ONLY the textbook passages" wording (not "AND your own knowledge") to prevent small models from ignoring provided context.

## Environment (.env)

```
MODE=full                    # lite or full
WHISPER_MODEL=base           # tiny | base | small
WHISPER_DEVICE=cuda          # cuda | cpu (informational; FasterWhisperASR uses device=auto internally)
WHISPER_COMPUTE_TYPE=float16 # float16 (GPU) | int8 (CPU) (informational; FasterWhisperASR uses compute_type=auto internally)
AUDIO_DEVICE_INDEX=-1        # -1 = auto-detect, or pick from /api/devices
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_NUM_GPU=-1            # -1 = GPU (sends num_gpu:999 to Ollama), 0 = CPU (sends num_gpu:0)
CHROMA_PATH=C:/Users/aidan/AppData/Local/lecture-assistant/chroma_db
```

## Python environment

- `.venv` uses **Python 3.12** (`py -3.12 -m venv .venv`). Python 3.14 is incompatible with PyTorch wheels.
- PyTorch: `2.5.1+cu121` (CUDA 12.1, RTX 4060).
- WhisperLiveKit requires `faster-whisper>=1.2.0`. Installing via `pip install -e WhisperLiveKit/` upgrades it automatically.
- Two env vars are set in `main.py` before any imports: `HF_HUB_DISABLE_SYMLINKS_WARNING=1` (harmless on Windows without Developer Mode) and `ANONYMIZED_TELEMETRY=False` (ChromaDB posthog API mismatch in 0.5.x).
- On Windows, use `npm.cmd` not `npm` in PowerShell (execution policy blocks `.ps1` wrappers).
- **Do not install `datasets` or `pyarrow` on Windows.** `pyarrow 24.0.0` (pulled by `datasets`) causes an `arrow.dll` access violation (exit code -1073741819) that crashes the entire Python process on startup. Neither package is required by this app.

## Dependencies

- `requirements-lite.txt` — FastAPI, uvicorn, faster-whisper, sounddevice, pyaudiowpatch
- `requirements-full.txt` — extends lite + httpx, chromadb, sentence-transformers, torch, PyMuPDF, whisperlivekit
- `requirements-dev.txt` — extends full + pytest, ruff
- CUDA PyTorch must be installed before `requirements-full.txt`: `pip install torch --index-url https://download.pytorch.org/whl/cu121`

## Install scripts

- `install.ps1` — Windows (interactive, GPU-aware, installs Ollama, builds frontend)
- `install.sh` — macOS/Linux (checks BlackHole on macOS, ROCm on Linux)

Both scripts write `.env` and are idempotent (safe to re-run to change mode).
