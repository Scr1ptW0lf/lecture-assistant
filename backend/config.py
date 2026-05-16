import os
import platform
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_chroma_path() -> str:
    if platform.system() == "Windows":
        local = os.environ.get("LOCALAPPDATA", "")
        if local:
            return os.path.join(local, "lecture-assistant", "chroma_db")
    return "./chroma_db"


class Settings(BaseSettings):
    mode: str = "full"  # "lite" or "full"
    debug: bool = False  # enable verbose LLM/API/startup logging; silences WhisperLiveKit noise

    # Audio
    audio_device_index: int = -1  # -1 = auto-detect loopback
    audio_sample_rate: int = 16000
    audio_chunk_seconds: float = 2.5

    # Whisper
    whisper_model: str = "base"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"

    # Ollama (full mode only)
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2:3b"
    ollama_num_gpu: int = -1  # -1 = Ollama default (GPU when available), 0 = force CPU

    # ChromaDB (full mode only)
    chroma_path: str = _default_chroma_path()
    chroma_collection: str = "textbook"
    rag_top_k: int = 6
    pdf_chunk_size: int = 1000
    pdf_chunk_overlap: int = 150

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    def model_post_init(self, __context):
        # Apply sensible defaults when not overridden in .env
        if self.mode == "lite" and self.whisper_model == "base":
            object.__setattr__(self, "whisper_model", "tiny")
        if self.whisper_device == "cuda" and self.whisper_compute_type == "int8":
            object.__setattr__(self, "whisper_compute_type", "float16")


settings = Settings()
