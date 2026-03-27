"""File-system cache for pipeline execution results."""
import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class FileSystemCache:
    """Stores and retrieves execution results on disk keyed by content hash."""

    def __init__(self, base_dir: str | Path) -> None:
        self._base_dir = Path(base_dir)
        self._base_dir.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()

    # ── helpers ────────────────────────────────────────────────────────────

    def get_path(self, hash_key: str, extension: str = ".bin") -> Path:
        """Return the filesystem path for a given hash key."""
        if not re.fullmatch(r"[0-9a-fA-F]+", hash_key):
            raise ValueError(f"Invalid hash key: {hash_key!r}")
        return self._base_dir / f"{hash_key}{extension}"

    # ── binary data ───────────────────────────────────────────────────────

    async def store(self, hash_key: str, data: bytes, extension: str = ".bin") -> Path:
        """Write *data* to disk and return the path."""
        path = self.get_path(hash_key, extension)
        async with self._lock:
            await asyncio.to_thread(path.write_bytes, data)
        logger.debug("Cached %s (%d bytes)", path.name, len(data))
        return path

    async def retrieve(self, hash_key: str, extension: str = ".bin") -> bytes | None:
        """Read cached bytes or return ``None`` if absent."""
        path = self.get_path(hash_key, extension)
        async with self._lock:
            exists = await asyncio.to_thread(path.exists)
            if exists:
                return await asyncio.to_thread(path.read_bytes)
        return None

    async def exists(self, hash_key: str, extension: str = ".bin") -> bool:
        """Check whether a cache entry exists."""
        path = self.get_path(hash_key, extension)
        async with self._lock:
            return await asyncio.to_thread(path.exists)

    # ── JSON data ─────────────────────────────────────────────────────────

    async def store_json(self, hash_key: str, data: Any) -> Path:
        """Serialize *data* as JSON and store it."""
        raw = json.dumps(data, default=str).encode()
        return await self.store(hash_key, raw, extension=".json")

    async def retrieve_json(self, hash_key: str) -> Any | None:
        """Deserialize and return cached JSON data, or ``None``."""
        raw = await self.retrieve(hash_key, extension=".json")
        if raw is None:
            return None
        return json.loads(raw)

    # ── deletion ─────────────────────────────────────────────────────────

    async def delete(self, hash_key: str, extension: str = ".bin") -> bool:
        """Remove a specific cached file. Returns True if file was removed."""
        path = self.get_path(hash_key, extension)
        async with self._lock:
            exists = await asyncio.to_thread(path.exists)
            if exists:
                await asyncio.to_thread(path.unlink)
                return True
        return False

    async def delete_by_prefix(self, prefix: str) -> int:
        """Remove all cached files whose name starts with *prefix*."""
        count = 0
        async with self._lock:
            items = await asyncio.to_thread(lambda: list(self._base_dir.iterdir()))
            for item in items:
                if item.is_file() and item.name.startswith(prefix):
                    await asyncio.to_thread(item.unlink)
                    count += 1
        return count

    # ── maintenance ───────────────────────────────────────────────────────

    async def clear(self) -> int:
        """Remove every file in the cache directory. Returns count deleted."""
        count = 0
        async with self._lock:
            items = await asyncio.to_thread(lambda: list(self._base_dir.iterdir()))
            for item in items:
                if item.is_file():
                    await asyncio.to_thread(item.unlink)
                    count += 1
        logger.info("Cache cleared – %d file(s) removed", count)
        return count


# ── shared singleton ──────────────────────────────────────────────────────

_shared_cache: FileSystemCache | None = None


def get_shared_cache() -> FileSystemCache:
    """Return the shared ``FileSystemCache`` singleton (lazy-initialised)."""
    global _shared_cache
    if _shared_cache is None:
        from app.config import settings

        _shared_cache = FileSystemCache(settings.CACHE_DIR)
    return _shared_cache
