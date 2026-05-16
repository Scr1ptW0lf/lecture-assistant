"""
Entry point — starts the FastAPI server.

Development:
    python main.py

Then open http://localhost:8000
For live frontend reloading: run `npm run dev` in /frontend and open http://localhost:5173
"""
import os
from contextlib import asynccontextmanager
from pathlib import Path

# Suppress HuggingFace symlinks warning (harmless on Windows without Developer Mode)
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
# Disable ChromaDB telemetry (avoids posthog capture() API mismatch in 0.5.x)
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")

import logging

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.routers import devices, settings as settings_router, ws_transcribe

_NOISY_LOGGERS = (
    "whisperlivekit",
    "faster_whisper",
    "httpx",
    "httpcore",
    "chromadb",
    "sentence_transformers",
)


def _configure_logging() -> None:
    if not settings.debug:
        return
    # Lower root so backend DEBUG messages pass through uvicorn's handler.
    logging.root.setLevel(logging.DEBUG)
    # Silence third-party noise so our DEBUG lines stand out.
    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
    # Ensure our own loggers emit DEBUG.
    logging.getLogger("backend").setLevel(logging.DEBUG)
    logging.getLogger("__main__").setLevel(logging.DEBUG)


_configure_logging()

DIST = Path(__file__).parent / "frontend" / "dist"


_logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Re-apply after uvicorn's dictConfig has run (uvicorn configures logging on startup).
    _configure_logging()

    if settings.debug:
        _logger.debug("=== STARTUP PARAMETERS ===")
        for k, v in settings.model_dump().items():
            _logger.debug("  %-28s = %s", k, v)
        _logger.debug("=== END STARTUP PARAMETERS ===")

    # Pre-load Whisper model so the first WS connection is fast
    from backend.transcription import load
    load()

    if settings.mode == "full":
        # Block startup until Ollama has loaded the model into VRAM.
        # This means the first user query is instant instead of waiting 3-5 s.
        from backend.llm import ollama
        await ollama.warmup()

    yield


app = FastAPI(title="Lecture Assistant", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers available in both modes
app.include_router(devices.router)
app.include_router(settings_router.router)
app.include_router(ws_transcribe.router)


@app.get("/api/config")
def get_config():
    return {"mode": settings.mode}


# Full-mode-only routers
if settings.mode == "full":
    from backend.routers import ingest, qa
    app.include_router(ingest.router)
    app.include_router(qa.router)


# Serve the built React app (after `npm run build` in /frontend)
if DIST.exists():
    app.mount("/", StaticFiles(directory=str(DIST), html=True), name="static")
else:
    @app.get("/")
    def index():
        return {
            "message": "Frontend not built yet. Run: cd frontend && npm install && npm run build"
        }


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
