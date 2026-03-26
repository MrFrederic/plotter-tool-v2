"""File upload router for storing user files in the cache directory."""
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.config import settings

router = APIRouter(prefix="/upload", tags=["upload"])


MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB


@router.post("/")
async def upload_file(file: UploadFile = File(...)) -> dict:
    """Accept an uploaded file, store it with a unique name, and return metadata."""
    uploads_dir = Path(settings.CACHE_DIR) / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)

    original_name = file.filename or "upload"
    ext = Path(original_name).suffix
    unique_name = f"{uuid4()}{ext}"
    dest = uploads_dir / unique_name

    try:
        content = await file.read()
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=413, detail="File exceeds maximum upload size of 50 MB"
            )
        dest.write_bytes(content)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {exc}") from exc

    return {
        "filename": original_name,
        "path": str(dest),
        "size": len(content),
    }
