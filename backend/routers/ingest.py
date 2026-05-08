from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.rag import get_rag

router = APIRouter()


@router.post("/api/ingest")
async def ingest_pdf(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    pdf_bytes = await file.read()
    chunk_count = get_rag().ingest_pdf(pdf_bytes, source_name=file.filename or "upload.pdf")
    return {"status": "ok", "chunks_stored": chunk_count, "filename": file.filename}


@router.get("/api/rag/status")
async def rag_status():
    count = get_rag().collection_count()
    return {"chunks_stored": count, "has_textbook": count > 0}


@router.get("/api/rag/sources")
async def rag_sources():
    """Return the list of PDF source names stored in ChromaDB."""
    return {"sources": get_rag().get_sources()}


@router.delete("/api/rag/sources")
async def clear_rag_sources():
    """Delete all documents from ChromaDB."""
    deleted = get_rag().delete_all_sources()
    return {"deleted": deleted}
