import re
import asyncio
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import settings

router = APIRouter()

ENV_PATH = Path(".env")

_FIELD_TO_ENV = {
    "whisper_model": "WHISPER_MODEL",
    "whisper_device": "WHISPER_DEVICE",
    "whisper_compute_type": "WHISPER_COMPUTE_TYPE",
    "ollama_model": "OLLAMA_MODEL",
    "ollama_num_gpu": "OLLAMA_NUM_GPU",
}

VALID = {
    "whisper_model": {"tiny", "base", "small"},
    "whisper_device": {"cpu", "cuda"},
    "whisper_compute_type": {"int8", "float16", "int8_float16"},
}


class SettingsUpdate(BaseModel):
    whisper_model: str | None = None
    whisper_device: str | None = None
    whisper_compute_type: str | None = None
    ollama_model: str | None = None
    ollama_num_gpu: int | None = None


@router.get("/api/settings")
def get_settings():
    return {
        "whisper_model": settings.whisper_model,
        "whisper_device": settings.whisper_device,
        "whisper_compute_type": settings.whisper_compute_type,
        "ollama_model": settings.ollama_model,
        "ollama_num_gpu": settings.ollama_num_gpu,
        "mode": settings.mode,
    }


@router.post("/api/settings")
def update_settings(body: SettingsUpdate):
    updates = body.model_dump(exclude_none=True)

    for field, value in updates.items():
        if field in VALID and value not in VALID[field]:
            raise HTTPException(status_code=422, detail=f"Invalid value '{value}' for {field}")

    for field, value in updates.items():
        object.__setattr__(settings, field, value)

    _write_env(updates)
    return get_settings()


@router.get("/api/ollama/models")
async def list_ollama_models():
    """Return locally available Ollama model names."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{settings.ollama_base_url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
        names = sorted(m["name"] for m in data.get("models", []))
        return {"models": names}
    except Exception:
        return {"models": []}


@router.post("/api/reinitialize")
async def reinitialize():
    from backend import transcription
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, transcription.load)
    return {"ok": True}


def _write_env(updates: dict[str, str]) -> None:
    try:
        lines = ENV_PATH.read_text(encoding="utf-8").splitlines(keepends=True)
    except FileNotFoundError:
        lines = []

    for field, value in updates.items():
        env_key = _FIELD_TO_ENV.get(field)
        if not env_key:
            continue
        found = False
        for i, line in enumerate(lines):
            if re.match(rf"^{env_key}\s*=", line):
                lines[i] = f"{env_key}={value}\n"
                found = True
                break
        if not found:
            lines.append(f"{env_key}={value}\n")

    ENV_PATH.write_text("".join(lines), encoding="utf-8")
