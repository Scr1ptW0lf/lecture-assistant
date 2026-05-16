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

# Most-recent session's transcript — updated by reference so QA can read live state.
_session_transcript: list = []


def get_transcript_context(max_chars: int = 4000) -> str:
    """Return a plain-text excerpt of the current session transcript for QA context."""
    if not _session_transcript:
        return ""
    text = " ".join(e.get("text", "") for e in _session_transcript)
    return text[-max_chars:] if len(text) > max_chars else text

_HALLUCINATION = re.compile(
    r"^[.…,!?\-\s]+$"
    r"|^(uh+|um+|hmm*|hm+)\.?$"
    r"|^thank you\.?$"
    r"|^thanks\.?$"
    r"|^you\.?$"
    r"|^bye(-bye)?\.?$"
    r"|^goodbye\.?$"
    r"|^see you\.?$"
    r"|^\[.+\]$",
    re.IGNORECASE,
)


def _is_hallucination(text: str) -> bool:
    return bool(_HALLUCINATION.match(text.strip()))


def _parse_ts(ts: str) -> float | None:
    """Parse 'H:MM:SS.ff' timestamp string to float seconds."""
    m = re.match(r'^(\d+):(\d{2}):(\d{2})\.(\d+)$', ts)
    if not m:
        return None
    frac = float("0." + m.group(4))
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + frac


def _format_ts(secs: float) -> str:
    """Format float seconds back to 'H:MM:SS.cc'."""
    h = int(secs // 3600)
    secs -= h * 3600
    m = int(secs // 60)
    secs -= m * 60
    return f"{h}:{m:02d}:{secs:05.2f}"


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

    if settings.debug:
        logger.debug(
            "=== WS CONNECT ===\n"
            "  student_name : %r\n"
            "  device_index : %d\n"
            "  source       : %r\n"
            "  content_type : %s\n"
            "  user_context : %r",
            student_name, device_index, source, content_type, user_context,
        )

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
    # Also aliased to module-level _session_transcript so the QA endpoint can read it.
    global _session_transcript
    all_transcript_lines: list = []
    _session_transcript = all_transcript_lines

    # Outbox queue: all tasks enqueue messages here; ws_sender is the sole WebSocket writer.
    # put_nowait never blocks, so send_results is never stalled by WebSocket send latency.
    outbox: asyncio.Queue = asyncio.Queue()

    async def ws_sender():
        """Drain outbox and write to WebSocket. Single writer — no lock needed."""
        while True:
            try:
                msg = await outbox.get()
                await websocket.send_json(msg)
            except asyncio.CancelledError:
                break
            except Exception:
                break

    _CONTENT_FOCUS = {
        "lecture":  "key concepts, definitions, examples, and topics covered by the instructor",
        "meeting":  "decisions made, action items, key discussion points, and any next steps",
        "video":    "main topics, key takeaways, and important information presented",
        "podcast":  "topics discussed, key insights, and notable points raised",
        "general":  "key topics and ideas discussed",
    }

    async def stream_summary(summary_id: str, new_lines: list, prior_summary: str = "") -> str:
        """
        Stream a summary of new_lines, optionally extending prior_summary.
        Returns the completed summary text.
        """
        if settings.mode != "full":
            return ""
        try:
            from backend.llm import ollama

            new_text = " ".join(
                entry["text"] for entry in new_lines if entry.get("text", "").strip()
            )
            if not new_text.strip():
                return ""

            focus = _CONTENT_FOCUS.get(content_type, _CONTENT_FOCUS["general"])
            context_line = f"Context: {user_context}\n" if user_context else ""
            content_label = {"lecture": "lecture", "meeting": "meeting", "video": "video",
                             "podcast": "podcast", "general": "audio recording"}.get(content_type, "audio recording")

            if prior_summary:
                prompt = (
                    f"{context_line}"
                    f"You are maintaining a running summary of a live {content_label}. "
                    "The transcript is raw — ignore filler words and formatting artifacts.\n\n"
                    f"PREVIOUS SUMMARY:\n{prior_summary}\n\n"
                    f"NEW TRANSCRIPT (since last summary):\n{new_text}\n\n"
                    f"Extend the summary with new information about {focus}. "
                    "Keep all previous bullet points and add new ones for what was just covered. "
                    "Use 3-8 bullet points total. Use **bold** for key terms. Be specific.\n\nUPDATED SUMMARY:"
                )
            else:
                prompt = (
                    f"{context_line}"
                    f"You are summarizing a live {content_label}. "
                    "The transcript below is raw — it contains sentence fragments, "
                    "filler words, and may lack proper punctuation. "
                    "Ignore formatting artifacts and focus on actual content.\n\n"
                    f"TRANSCRIPT SO FAR:\n{new_text}\n\n"
                    f"Write a concise summary focusing on {focus}. "
                    "Use 3-5 bullet points. Use **bold** for key terms. "
                    "Be specific to what was actually said.\n\nSUMMARY:"
                )

            collected: list[str] = []
            async for token in ollama.chat_stream(prompt):
                collected.append(token)
                outbox.put_nowait({"type": "summary", "id": summary_id, "token": token, "done": False})

            outbox.put_nowait({"type": "summary", "id": summary_id, "token": "", "done": True})
            return "".join(collected)
        except Exception as e:
            logger.error("stream_summary error: %s", e)
            return ""

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

        WhisperLiveKit internally prunes validated_segments older than 5 minutes
        (tokens_alignment._DEFAULT_RETENTION_SECONDS). To prevent data loss we maintain
        all_frontend_lines — our own ordered dict that accumulates every line for the full
        session and is never pruned.  The sub_key (start field) uses the stable
        "start_key:s_idx" scheme so the same sentence always gets the same key even as the
        in-progress segment grows.  display_ts is interpolated from word position and may
        update until the segment is committed, which is fine.
        """
        alerted_starts: set[str] = set()
        # Ordered dict sub_key → entry; never pruned, replaces WhisperLiveKit's pruned view.
        # Entries are updated IN PLACE so all_transcript_lines references stay current.
        all_frontend_lines: dict[str, dict] = {}

        try:
            async for response in results_gen:
                d = response.to_dict()

                new_alerts = []

                for line in d.get("lines", []):
                    text = (line.get("text") or "").strip()
                    if not text or line.get("speaker") == -2 or _is_hallucination(text):
                        continue

                    start_key = line.get("start", "")
                    end_key = line.get("end", "")

                    sentences = _split_sentences(text)
                    total_words = max(1, sum(len(s.split()) for s in sentences))

                    start_secs = _parse_ts(start_key)
                    end_secs = _parse_ts(end_key)
                    can_interp = (
                        start_secs is not None
                        and end_secs is not None
                        and end_secs > start_secs + 0.5
                    )

                    word_offset = 0
                    for s_idx, sentence in enumerate(sentences):
                        # Stable dedup key — never changes once the sentence is added.
                        sub_key = start_key if s_idx == 0 else f"{start_key}:{s_idx}"

                        # Display timestamp: interpolated from word position for nicer UI.
                        # Updates as in-progress segment grows; stabilises once committed.
                        if can_interp and s_idx > 0:
                            frac = word_offset / total_words
                            est = start_secs + frac * (end_secs - start_secs)  # type: ignore[operator]
                            display_ts = _format_ts(est)
                        else:
                            display_ts = start_key

                        word_offset += len(sentence.split())

                        sub_name_hit = detect_name(sentence, student_name)

                        if sub_name_hit and sub_key not in alerted_starts:
                            alerted_starts.add(sub_key)
                            new_alerts.append(sentence)
                            if settings.debug:
                                logger.debug("NAME DETECTED in [%s]: %r", sub_key, sentence)

                        new_fields = {
                            "start": sub_key,
                            "display_ts": display_ts,
                            "end": end_key,
                            "text": sentence,
                            "name_detected": sub_name_hit,
                        }

                        if sub_key not in all_frontend_lines:
                            # First time: insert and add the same dict object to the transcript
                            # accumulator so future in-place updates are visible to summary_loop.
                            all_frontend_lines[sub_key] = new_fields
                            all_transcript_lines.append(all_frontend_lines[sub_key])
                        else:
                            # Update in place — preserves the reference held by all_transcript_lines.
                            all_frontend_lines[sub_key].update(new_fields)

                buffer = (d.get("buffer_transcription") or "").strip()

                outbox.put_nowait({
                    "type": "state",
                    "lines": list(all_frontend_lines.values()),
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
        """
        Fire a cumulative summary every 2 minutes.
        Each round passes only the NEW lines since the last summary, plus the previous summary
        text, so the LLM grows the summary incrementally rather than re-reading everything.
        """
        summary_count = 0
        last_summarized_idx = 0
        prior_summary_text = ""

        while True:
            await asyncio.sleep(SUMMARY_INTERVAL_SECONDS)
            new_lines = all_transcript_lines[last_summarized_idx:]
            if not new_lines:
                continue

            summary_count += 1
            summary_id = f"summary-{summary_count}"
            last_summarized_idx = len(all_transcript_lines)

            if settings.debug:
                logger.debug(
                    "=== SUMMARY TRIGGER id=%s  new_lines=%d  prior_summary=%d chars ===",
                    summary_id, len(new_lines), len(prior_summary_text),
                )

            # Await directly so we can capture completed text for the next round.
            completed = await stream_summary(summary_id, list(new_lines), prior_summary_text)
            if completed:
                prior_summary_text = completed

    on_demand_count = 0

    sender_task = asyncio.create_task(ws_sender())
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
                            stream_summary(
                                f"summary-demand-{on_demand_count}",
                                list(all_transcript_lines),
                                "",  # on-demand: full transcript summary from scratch
                            )
                        )
                except Exception:
                    pass
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        feed_task.cancel()
        results_task.cancel()
        summary_task.cancel()
        sender_task.cancel()
        try:
            await asyncio.gather(feed_task, results_task, summary_task, sender_task, return_exceptions=True)
        except Exception:
            pass
        await audio_processor.process_audio(b"")
        await audio_processor.cleanup()
        if stream:
            stream.stop()
