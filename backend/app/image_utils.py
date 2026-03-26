"""Helpers for encoding / decoding images passed between plugins."""
import base64

import cv2
import numpy as np


def encode_image(img: np.ndarray) -> str:
    """Encode a NumPy image to a base64-encoded PNG string."""
    success, buffer = cv2.imencode(".png", img)
    if not success:
        raise ValueError("Failed to encode image to PNG")
    return base64.b64encode(buffer.tobytes()).decode("ascii")


def decode_image(data: str | list) -> np.ndarray:
    """Decode a base64 PNG string (or legacy nested list) back to NumPy array."""
    if isinstance(data, str):
        raw = base64.b64decode(data)
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
        if img is None:
            raise ValueError("Failed to decode image from base64 data")
        return img
    # Legacy path: nested Python list
    return np.array(data, dtype=np.uint8)
