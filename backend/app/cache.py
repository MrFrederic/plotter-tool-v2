"""File-system cache for pipeline execution results."""
import json
import logging
import re
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class FileSystemCache:
    """Stores and retrieves execution results on disk keyed by content hash."""

    def __init__(self, base_dir: str | Path) -> None:
        self._base_dir = Path(base_dir)
        self._base_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    # ── helpers ────────────────────────────────────────────────────────────

    def get_path(self, hash_key: str, extension: str = ".bin") -> Path:
        """Return the filesystem path for a given hash key."""
        if not re.fullmatch(r"[0-9a-fA-F]+", hash_key):
            raise ValueError(f"Invalid hash key: {hash_key!r}")
        return self._base_dir / f"{hash_key}{extension}"

    # ── binary data ───────────────────────────────────────────────────────

    def store(self, hash_key: str, data: bytes, extension: str = ".bin") -> Path:
        """Write *data* to disk and return the path."""
        path = self.get_path(hash_key, extension)
        with self._lock:
            path.write_bytes(data)
        logger.debug("Cached %s (%d bytes)", path.name, len(data))
        return path

    def retrieve(self, hash_key: str, extension: str = ".bin") -> bytes | None:
        """Read cached bytes or return ``None`` if absent."""
        path = self.get_path(hash_key, extension)
        with self._lock:
            if path.exists():
                return path.read_bytes()
        return None

    def exists(self, hash_key: str, extension: str = ".bin") -> bool:
        """Check whether a cache entry exists."""
        return self.get_path(hash_key, extension).exists()

    # ── JSON data ─────────────────────────────────────────────────────────

    def store_json(self, hash_key: str, data: Any) -> Path:
        """Serialize *data* as JSON and store it."""
        raw = json.dumps(data, default=str).encode()
        return self.store(hash_key, raw, extension=".json")

    def retrieve_json(self, hash_key: str) -> Any | None:
        """Deserialize and return cached JSON data, or ``None``."""
        raw = self.retrieve(hash_key, extension=".json")
        if raw is None:
            return None
        return json.loads(raw)

    # ── maintenance ───────────────────────────────────────────────────────

    def clear(self) -> int:
        """Remove every file in the cache directory. Returns count deleted."""
        count = 0
        with self._lock:
            for item in self._base_dir.iterdir():
                if item.is_file():
                    item.unlink()
                    count += 1
        logger.info("Cache cleared – %d file(s) removed", count)
        return count
