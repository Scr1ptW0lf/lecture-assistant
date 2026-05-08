"""
RAG pipeline: PDF ingestion → ChromaDB storage → semantic retrieval.
Only loaded when MODE=full.
"""
import logging
import os

import fitz  # PyMuPDF  # type: ignore
import chromadb  # type: ignore
from sentence_transformers import SentenceTransformer  # type: ignore

from backend.config import settings

logger = logging.getLogger(__name__)


class RAGPipeline:
    def __init__(self):
        os.makedirs(settings.chroma_path, exist_ok=True)
        self._client = chromadb.PersistentClient(path=settings.chroma_path)
        self._collection = self._client.get_or_create_collection(
            name=settings.chroma_collection,
            metadata={"hnsw:space": "cosine"},
        )
        self._embedder = SentenceTransformer("all-MiniLM-L6-v2")
        self._chunk_size = settings.pdf_chunk_size
        self._overlap = settings.pdf_chunk_overlap
        self._top_k = settings.rag_top_k

    # ------------------------------------------------------------------
    # Ingestion
    # ------------------------------------------------------------------

    def ingest_pdf(self, pdf_bytes: bytes, source_name: str) -> int:
        """Extract, chunk, embed, and upsert PDF into ChromaDB. Returns chunk count."""
        text = self._extract_text(pdf_bytes)
        chunks = self._chunk_text(text)
        if not chunks:
            return 0

        embeddings = self._embedder.encode(chunks, show_progress_bar=False).tolist()
        ids = [f"{source_name}::chunk::{i}" for i in range(len(chunks))]
        metadatas = [{"source": source_name, "chunk_index": i} for i in range(len(chunks))]

        self._collection.upsert(
            ids=ids,
            documents=chunks,
            embeddings=embeddings,
            metadatas=metadatas,
        )
        return len(chunks)

    def _extract_text(self, pdf_bytes: bytes) -> str:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        return "\n".join(page.get_text() for page in doc)

    def _chunk_text(self, text: str) -> list[str]:
        chunks = []
        start = 0
        while start < len(text):
            end = start + self._chunk_size
            chunk = text[start:end].strip()
            if len(chunk) > 30:
                chunks.append(chunk)
            start += self._chunk_size - self._overlap
        return chunks

    # ------------------------------------------------------------------
    # Source management
    # ------------------------------------------------------------------

    def get_sources(self) -> list[str]:
        """Return sorted list of unique PDF source names stored in ChromaDB."""
        if self._collection.count() == 0:
            return []
        results = self._collection.get(include=["metadatas"])
        return sorted({m["source"] for m in results["metadatas"] if "source" in m})

    # ------------------------------------------------------------------
    # Retrieval
    # ------------------------------------------------------------------

    def retrieve(self, query: str, source: str | None = None) -> list[str]:
        """Return top-k chunks for the given source. Returns [] if source is None."""
        if source is None or self._collection.count() == 0:
            return []
        try:
            query_embedding = self._embedder.encode([query]).tolist()
            results = self._collection.query(
                query_embeddings=query_embedding,
                n_results=self._top_k,
                include=["documents"],
                where={"source": source},
            )
            return results["documents"][0] if results["documents"] else []
        except Exception as exc:
            logger.warning("RAG retrieve error (source=%s): %s", source, exc)
            return []

    def delete_all_sources(self) -> int:
        """Delete every document from the collection. Returns count deleted."""
        count = self._collection.count()
        if count == 0:
            return 0
        ids = self._collection.get(include=[])["ids"]
        self._collection.delete(ids=ids)
        return count

    def collection_count(self) -> int:
        return self._collection.count()


# Singleton — instantiated lazily in full mode only
_rag: RAGPipeline | None = None


def get_rag() -> RAGPipeline:
    global _rag
    if _rag is None:
        _rag = RAGPipeline()
    return _rag
