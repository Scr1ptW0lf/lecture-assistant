import json
import logging
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.llm import ollama
from backend.rag import get_rag
from backend.routers.ws_transcribe import get_transcript_context

router = APIRouter()
logger = logging.getLogger(__name__)

_SYSTEM_RAG = (
    "You are a study assistant. Answer the question using ONLY the textbook passages "
    "provided below. Quote or paraphrase them directly. If the passages do not contain "
    "enough information to answer, say so briefly — do not invent details."
)

_SYSTEM_TRANSCRIPT_RAG = (
    "You are a study assistant monitoring a live lecture. Answer the question using the "
    "textbook passages and recent transcript provided below. Ground your answer in those "
    "sources. If they do not contain enough information, use your general knowledge and indicate"
    "that you are."
)

_SYSTEM_TRANSCRIPT_ONLY = (
    "You are a study assistant monitoring a live lecture. Answer the question using the "
    "recent transcript below. If the transcript doesn't contain enough information, use "
    "your general knowledge and indicate that you are."
)

_SYSTEM_GENERAL = (
    "You are a helpful study assistant. Answer the student's question using your general "
    "knowledge. Be concise but thorough."
)


def build_prompt(
    question: str,
    source: Optional[str] = None,
    transcript_context: Optional[str] = None,
) -> str:
    """Build an Ollama prompt. source=None means no textbook — general knowledge only."""
    from backend.config import settings

    chunks: list[str] = []
    if source:
        try:
            chunks = get_rag().retrieve(question, source=source)
            if chunks:
                logger.debug("RAG: %d chunks for source=%s", len(chunks), source)
            else:
                logger.warning("RAG: 0 chunks for source=%s q=%.80s", source, question)
        except Exception as exc:
            logger.warning("RAG retrieval failed: %s", exc)

    rag_ctx = "\n\n---\n\n".join(chunks) if chunks else None

    if settings.debug:
        logger.debug(
            "=== QA REQUEST ===\n"
            "  question        : %s\n"
            "  source          : %s\n"
            "  rag_chunks      : %d\n"
            "  transcript_ctx  : %s chars\n"
            "  variant         : %s",
            question, source, len(chunks),
            len(transcript_context) if transcript_context else 0,
            "rag+transcript" if rag_ctx and transcript_context
            else "rag" if rag_ctx
            else "transcript" if transcript_context
            else "general",
        )
        if chunks:
            for i, c in enumerate(chunks):
                logger.debug("  chunk[%d]: %.200s", i, c.replace("\n", " "))

    if rag_ctx and transcript_context:
        return (
            f"{_SYSTEM_TRANSCRIPT_RAG}\n\n"
            f"RECENT TRANSCRIPT:\n{transcript_context}\n\n"
            f"TEXTBOOK PASSAGES:\n{rag_ctx}\n\n"
            f"QUESTION: {question}\n\nANSWER (based on the sources above):"
        )
    if rag_ctx:
        return (
            f"{_SYSTEM_RAG}\n\n"
            f"TEXTBOOK PASSAGES:\n{rag_ctx}\n\n"
            f"QUESTION: {question}\n\nANSWER (based on the passages above):"
        )
    if transcript_context:
        return (
            f"{_SYSTEM_TRANSCRIPT_ONLY}\n\n"
            f"RECENT TRANSCRIPT:\n{transcript_context}\n\n"
            f"QUESTION: {question}\n\nANSWER:"
        )
    return f"{_SYSTEM_GENERAL}\n\nQUESTION: {question}\n\nANSWER:"


class QARequest(BaseModel):
    question: str
    source: Optional[str] = None


@router.post("/api/qa")
async def ask_question(req: QARequest):
    transcript_ctx = get_transcript_context() or None
    prompt = build_prompt(req.question, source=req.source, transcript_context=transcript_ctx)

    async def generate():
        async for token in ollama.chat_stream(prompt):
            yield f"data: {json.dumps({'token': token})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
