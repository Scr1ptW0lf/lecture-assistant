"""
Transcription engine using WhisperLiveKit.

TranscriptionEngine is a singleton — loaded once at startup.
AudioProcessor is created per WebSocket session.
"""
import logging

from whisperlivekit import AudioProcessor, WhisperLiveKitConfig
from whisperlivekit.core import TranscriptionEngine

from backend.config import settings

logger = logging.getLogger(__name__)

_engine: TranscriptionEngine | None = None


def load():
    """Load the Whisper model into the TranscriptionEngine singleton."""
    global _engine
    # Reset the singleton so a new engine is created with current settings.
    TranscriptionEngine.reset()
    config = WhisperLiveKitConfig.from_kwargs(
        model_size=settings.whisper_model,
        lan="en",
        pcm_input=True,          # accept raw s16le bytes, no FFmpeg
        vac=True,                # Silero VAD — skips silence, reduces hallucination
        diarization=False,
        transcription=True,
        backend="auto",          # auto-selects faster-whisper; uses CUDA if available
        backend_policy="localagreement",  # buffer text visible; tokens confirmed by LocalAgreement
    )
    _engine = TranscriptionEngine(config=config)
    logger.info("WhisperLiveKit TranscriptionEngine loaded (model=%s)", settings.whisper_model)


def make_processor() -> AudioProcessor:
    """Return a fresh AudioProcessor for one WebSocket session."""
    if _engine is None:
        load()
    return AudioProcessor(transcription_engine=_engine)
