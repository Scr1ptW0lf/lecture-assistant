"""Async Ollama HTTP client with streaming support."""
import json
from typing import AsyncGenerator

import httpx

from backend.config import settings


class OllamaClient:
    def __init__(self):
        self.base_url = settings.ollama_base_url

    def _ollama_options(self) -> dict:
        # Always send num_gpu explicitly so Ollama reloads the model on device change.
        # 0 = CPU, 999 = all layers to GPU (Ollama clamps to available layers).
        num_gpu = settings.ollama_num_gpu if settings.ollama_num_gpu >= 0 else 999
        return {"num_gpu": num_gpu}

    async def chat_stream(self, prompt: str) -> AsyncGenerator[str, None]:
        """Async generator yielding response tokens from Ollama."""
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/generate",
                json={"model": settings.ollama_model, "prompt": prompt, "stream": True, "options": self._ollama_options()},
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    data = json.loads(line)
                    yield data.get("response", "")
                    if data.get("done"):
                        break

    async def warmup(self):
        """Pre-load the model into VRAM to avoid cold-start on first query."""
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                await client.post(
                    f"{self.base_url}/api/generate",
                    json={"model": settings.ollama_model, "prompt": "hi", "stream": False, "options": self._ollama_options()},
                )
        except Exception:
            pass  # Ollama not running yet — first query will be slow


ollama = OllamaClient()
