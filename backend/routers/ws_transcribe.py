import asyncio
import json
import queue
import logging
import re

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.audio import get_loopback_stream
from backend.config import settings
from backend.name_detector import detect_name
from backend.transcription import make_processor

router = APIRouter()
logger = logging.getLogger(__name__)

SUMMARY_INTERVAL_SECONDS = 120

# Whisper hallucinations emitted on silence or near-silence audio.
_HALLUCINATION = re.compile(
    r"^[.…,!?\-\s]+$"             # punctuation/whitespace only
    r"|^(uh+|um+|hmm*|hm+)\.?$"   # filler sounds
    r"|^thank you\.?$"
    r"|^thanks\.?$"
    r"|^you\.?$"
    r"|^bye(-bye)?\.?$"
    r"|^goodbye\.?$"
    r"|^see you\.?$"
    r"|^\[.+\]$",                  # [Music], [Applause], etc.
    re.IGNORECASE,
)


def _is_hallucination(text: str) -> bool:
    return bool(_HALLUCINATION.match(text.strip()))


def _split_sentences(text: str, per_chunk: int = 4, max_words: int = 40) -> list[str]:
    """
    Split a long transcription segment into chunks of ~per_chunk sentences each.
    Falls back to word-count splitting for unpunctuated passages.
    """
    sentences = [s for s in re.split(r'(?<=[.!?])\s+', text.strip()) if s.strip()]
    if not sentences:
        return [text]
    out = []
    for i in range(0, len(sentences), per_chunk):
        chunk = " ".join(sentences[i : i + per_chunk]).strip()
        words = chunk.split()
        if len(words) <= max_words:
            out.append(chunk)
        else:
            for j in range(0, len(words), max_words):
                c = " ".join(words[j : j + max_words])
                if c:
                    out.append(c)
    return out or [text]


@router.websocket("/ws/transcribe")
async def transcribe_ws(websocket: WebSocket):
    await websocket.accept()

    try:
        init = await asyncio.wait_for(websocket.receive_json(), timeout=10)
    except Exception:
        init = {}

    student_name: str = init.get("student_name", "")
    device_index: int = int(init.get("device_index", -1))
    source: str | None = init.get("source") or None
    content_type: str = init.get("content_type") or "general"
    user_context: str = init.get("user_context") or ""

    audio_processor = make_processor()
    results_gen = await audio_processor.create_tasks()

    raw_queue: queue.Queue[np.ndarray] = queue.Queue()
    stream = None

    try:
        stream = get_loopback_stream(settings.audio_sample_rate, raw_queue, device_index)
    except Exception as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
        await audio_processor.cleanup()
        return

    await websocket.send_json({"type": "status", "message": "Transcription started"})

    # Shared accumulator: all de-duplicated transcript lines for this session.
    # Both send_results (appender) and summary_loop (reader) reference this list.
    all_transcript_lines: list = []

    # Serialise all WebSocket sends so concurrent summary tasks don't interleave frames.
    send_lock = asyncio.Lock()

    async def safe_send(data: dict):
        async with send_lock:
            try:
                await websocket.send_json(data)
            except Exception:
                pass

    _CONTENT_FOCUS = {
        "lecture":  "key concepts, definitions, examples, and topics covered by the instructor",
        "meeting":  "decisions made, action items, key discussion points, and any next steps",
        "video":    "main topics, key takeaways, and important information presented",
        "podcast":  "topics discussed, key insights, and notable points raised",
        "general":  "key topics and ideas discussed",
    }

    async def stream_summary(summary_id: str, transcript_lines: list):
        """Stream a cumulative summary of the audio transcript so far."""
        if settings.mode != "full":
            return
        try:
            from backend.llm import ollama

            transcript_text = " ".join(
                entry["text"] for entry in transcript_lines if entry.get("text", "").strip()
            )
            if not transcript_text.strip():
                return

            focus = _CONTENT_FOCUS.get(content_type, _CONTENT_FOCUS["general"])
            context_line = f"Context: {user_context}\n" if user_context else ""
            content_label = {"lecture": "lecture", "meeting": "meeting", "video": "video",
                             "podcast": "podcast", "general": "audio recording"}.get(content_type, "audio recording")

            prompt = (
                f"{context_line}"
                f"You are summarizing a live {content_label}. "
                "The transcript below is raw and unformatted — it contains sentence fragments, "
                "filler words, repeated phrases, and may lack proper punctuation. "
                "Ignore formatting artifacts and focus on actual content.\n\n"
                f"TRANSCRIPT SO FAR:\n{transcript_text}\n\n"
                f"Write a concise cumulative summary focusing on {focus}. "
                "Use 3-5 bullet points. Be specific to what was actually said.\n\nSUMMARY:"
            )

            async for token in ollama.chat_stream(prompt):
                await safe_send({"type": "summary", "id": summary_id, "token": token, "done": False})

            await safe_send({"type": "summary", "id": summary_id, "token": "", "done": True})
        except Exception as e:
            logger.error("stream_summary error: %s", e)

    async def feed_audio():
        """Drain loopback PCM from queue, convert float32→s16le, feed to WhisperLiveKit."""
        while True:
            try:
                chunk: np.ndarray = raw_queue.get_nowait()
                pcm = (np.clip(chunk, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
                await audio_processor.process_audio(pcm)
            except queue.Empty:
                await asyncio.sleep(0.02)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("feed_audio error: %s", e)

    async def send_results():
        """
        Consume WhisperLiveKit results and push full state to the client.

        Sends {type:"state", lines:[...], buffer:"..."} on every change.
        The frontend replaces its full line list — this avoids the sent_lines
        counter bug where the growing in-progress segment would stop being sent
        after the first iteration.
        """
        alerted_starts: set[str] = set()
        seen_starts: set[str] = set()

        try:
            async for response in results_gen:
                d = response.to_dict()

                frontend_lines = []
                new_alerts = []

                for line in d.get("lines", []):
                    text = (line.get("text") or "").strip()
                    if not text or line.get("speaker") == -2 or _is_hallucination(text):
                        continue

                    start_key = line.get("start", "")
                    end_key = line.get("end", "")

                    # Split long segments into individual sentences so the frontend
                    # receives many small lines it can group into paragraphs.
                    sentences = _split_sentences(text)
                    for s_idx, sentence in enumerate(sentences):
                        sub_key = start_key if s_idx == 0 else f"{start_key}:{s_idx}"
                        sub_name_hit = detect_name(sentence, student_name)

                        if sub_name_hit and sub_key not in alerted_starts:
                            alerted_starts.add(sub_key)
                            new_alerts.append(sentence)

                        entry = {"start": sub_key, "end": end_key, "text": sentence, "name_detected": sub_name_hit}
                        frontend_lines.append(entry)

                        if sub_key not in seen_starts:
                            seen_starts.add(sub_key)
                            all_transcript_lines.append(entry)

                buffer = (d.get("buffer_transcription") or "").strip()

                await safe_send({
                    "type": "state",
                    "lines": frontend_lines,
                    "buffer": buffer,
                    "new_name_alerts": new_alerts,
                })

        except asyncio.CancelledError:
            pass
        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.error("send_results error: %s", e, exc_info=True)

    async def summary_loop():
        """Fire a cumulative summary every 2 minutes while connected."""
        summary_count = 0
        while True:
            await asyncio.sleep(SUMMARY_INTERVAL_SECONDS)
            if not all_transcript_lines:
                continue
            summary_count += 1
            asyncio.create_task(
                stream_summary(f"summary-{summary_count}", list(all_transcript_lines))
            )

    on_demand_count = 0

    feed_task = asyncio.create_task(feed_audio())
    results_task = asyncio.create_task(send_results())
    summary_task = asyncio.create_task(summary_loop())

    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            text = msg.get("text")
            if text:
                try:
                    data = json.loads(text)
                    if data.get("type") == "request_summary" and all_transcript_lines:
                        on_demand_count += 1
                        asyncio.create_task(
                            stream_summary(f"summary-demand-{on_demand_count}", list(all_transcript_lines))
                        )
                except Exception:
                    pass
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        feed_task.cancel()
        results_task.cancel()
        summary_task.cancel()
        try:
            await asyncio.gather(feed_task, results_task, summary_task, return_exceptions=True)
        except Exception:
            pass
        await audio_processor.process_audio(b"")
        await audio_processor.cleanup()
        if stream:
            stream.stop()
