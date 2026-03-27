"""File upload router for storing user files in the cache directory."""
import asyncio
import logging
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/upload", tags=["upload"])

MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB

_EXT_TO_DATA_TYPE: dict[str, str] = {}
for _ext in ("png", "jpg", "jpeg", "bmp", "tiff", "tif", "webp", "gif"):
    _EXT_TO_DATA_TYPE[_ext] = "IMAGE"
for _ext in ("svg", "dxf", "ai", "eps"):
    _EXT_TO_DATA_TYPE[_ext] = "VECTOR"
for _ext in ("gcode", "nc", "ngc", "tap", "cnc"):
    _EXT_TO_DATA_TYPE[_ext] = "GCODE"
for _ext in ("txt", "md", "log", "csv", "tsv", "xml", "json", "yaml", "yml"):
    _EXT_TO_DATA_TYPE[_ext] = "TEXT"


def _classify_extension(ext: str) -> str:
    """Return a data-type label for a file extension."""
    return _EXT_TO_DATA_TYPE.get(ext.lstrip(".").lower(), "OTHER")


@router.post("/")
async def upload_file(
    file: UploadFile = File(...),
    session_id: str = Form(""),
) -> dict:
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
        await asyncio.to_thread(dest.write_bytes, content)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {exc}") from exc

    # Register in DB if session_id provided
    if session_id:
        try:
            from app.database import async_session
            from app.models import CachedFile

            data_type = _classify_extension(ext)

            async with async_session() as db:
                cached = CachedFile(
                    client_id=session_id,
                    node_id="__start__",
                    output_name="upload",
                    cache_hash=unique_name.removesuffix(ext) if ext else unique_name,
                    file_path=str(dest),
                    data_type=data_type,
                    is_upload=True,
                )
                db.add(cached)
                await db.commit()
        except Exception:
            logger.debug(
                "Failed to register upload in DB (session=%s, file=%s)",
                session_id,
                original_name,
                exc_info=True,
            )

    return {
        "filename": original_name,
        "path": str(dest),
        "size": len(content),
    }
