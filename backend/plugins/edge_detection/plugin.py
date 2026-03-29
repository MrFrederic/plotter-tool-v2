"""Edge Detection node — processes an image data stream through a configurable
computer-vision protocol and injects the detected boundaries into the pipeline
as PATH-format line segments.
"""

import math
from typing import Any

import cv2
import numpy as np

from app.image_utils import decode_image
from app.plugin_base import (
    BasePlugin,
    ParameterDefinition,
    PluginSchema,
    PortDefinition,
    PortType,
)


class EdgeDetection(BasePlugin):
    """Executes an edge-detection protocol on an input image and routes the
    resulting contours into the pipeline as PATH-format line segments."""

    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="Edge Detection",
            category="Processing",
            description="file:details.md",
            inputs=[
                PortDefinition(
                    name="image",
                    type=PortType.IMAGE,
                    description=(
                        "Source image data stream to process. Accepts color or "
                        "grayscale raster input (base64 PNG). Feed a photo, scan, "
                        "or drawing into this port."
                    ),
                ),
            ],
            outputs=[
                PortDefinition(
                    name="path",
                    type=PortType.PATH,
                    description=(
                        "Output channel carrying detected boundaries as PATH objects. "
                        "Each contour is a separate path; closed loops are marked "
                        "accordingly. Route this to sorting, filtering, or export nodes."
                    ),
                ),
            ],
            parameters=[
                ParameterDefinition(
                    name="algorithm",
                    type="select",
                    default="canny",
                    options=["canny", "sobel", "laplacian"],
                    description=(
                        "Selects the detection protocol to execute. `canny` is the "
                        "recommended default — it uses two thresholds and hysteresis to "
                        "produce clean, crisp outlines. `sobel` delivers bolder "
                        "gradient-based edges with more texture. `laplacian` captures "
                        "fine all-direction detail but is the most noise-sensitive."
                    ),
                ),
                ParameterDefinition(
                    name="low_threshold",
                    type="number",
                    default=50,
                    min=0,
                    max=255,
                    step=1,
                    visible_if={"parameter": "algorithm", "equals": "canny"},
                    description=(
                        "Active when `algorithm` is `canny`. Lower hysteresis bound: "
                        "pixels below this value are discarded unless connected to a "
                        "strong edge. Lower = more faint lines retained, more noise."
                    ),
                ),
                ParameterDefinition(
                    name="high_threshold",
                    type="number",
                    default=150,
                    min=0,
                    max=255,
                    step=1,
                    visible_if={"parameter": "algorithm", "equals": "canny"},
                    description=(
                        "Active when `algorithm` is `canny`. Upper hysteresis bound: "
                        "pixels above this value are immediately classified as strong "
                        "edges. Raise to keep only the most defined boundaries; lower "
                        "to capture more edge data."
                    ),
                ),
                ParameterDefinition(
                    name="kernel_size",
                    type="select",
                    default="3",
                    options=["1", "3", "5", "7"],
                    visible_if={
                        "parameter": "algorithm",
                        "one_of": ["sobel", "laplacian"],
                    },
                    description=(
                        "Active when `algorithm` is `sobel` or `laplacian`. Sets the "
                        "pixel neighborhood used to compute local intensity change. "
                        "Smaller values preserve sharp detail; larger values smooth "
                        "noise at the cost of softening fine edges."
                    ),
                ),
                ParameterDefinition(
                    name="blur_kernel_size",
                    type="number",
                    default=5,
                    min=1,
                    max=31,
                    step=2,
                    description=(
                        "Gaussian blur applied to the image before the detection "
                        "protocol runs (odd values only). Increase to suppress grain "
                        "and noise; at very high values thin features may vanish entirely."
                    ),
                ),
                ParameterDefinition(
                    name="simplification_tolerance",
                    type="number",
                    default=1.0,
                    min=0.0,
                    max=10.0,
                    step=0.1,
                    description=(
                        "Douglas-Peucker tolerance applied to each contour after "
                        "detection. `0` preserves all points; higher values reduce "
                        "segment count and output weight. Very high values can distort "
                        "curved shapes into rough polygons."
                    ),
                ),
                ParameterDefinition(
                    name="min_contour_length",
                    type="number",
                    default=10,
                    min=0,
                    max=1000,
                    step=1,
                    description=(
                        "Minimum perimeter (in pixels) a contour must reach to be "
                        "authorized for output. Raise to filter out noise artifacts and "
                        "stray marks; set too high and small intentional features will "
                        "also be dropped."
                    ),
                ),
                ParameterDefinition(
                    name="invert",
                    type="boolean",
                    default=False,
                    description=(
                        "Swaps black and white in the edge map before contour extraction. "
                        "Enable when subject and background contrast is reversed from "
                        "expected — it flips which regions the system traces as paths."
                    ),
                ),
                ParameterDefinition(
                    name="grayscale",
                    type="boolean",
                    default=True,
                    description=(
                        "Converts the image to single-channel grayscale before the "
                        "detection protocol executes. Recommended on for consistent "
                        "results. Has no effect if the input is already single-channel."
                    ),
                ),
            ],
        )

    async def process(
        self, inputs: dict[str, Any], params: dict[str, Any]
    ) -> dict[str, Any]:
        # ------------------------------------------------------------------
        # 1. Validate & decode input image
        # ------------------------------------------------------------------
        raw_image = inputs.get("image")
        if raw_image is None or not isinstance(raw_image, str):
            raise ValueError("Missing or invalid image input")

        try:
            img = decode_image(raw_image)
        except Exception as exc:
            raise ValueError("Failed to decode input image") from exc

        # ------------------------------------------------------------------
        # 2. Read parameters with defaults
        # ------------------------------------------------------------------
        algorithm: str = params.get("algorithm", "canny")
        low_threshold: int = int(params.get("low_threshold", 50))
        high_threshold: int = int(params.get("high_threshold", 150))
        kernel_size: int = int(params.get("kernel_size", 3))
        blur_kernel_size: int = int(params.get("blur_kernel_size", 5))
        simplification_tolerance: float = float(
            params.get("simplification_tolerance", 1.0)
        )
        min_contour_length: int = int(params.get("min_contour_length", 10))
        invert: bool = bool(params.get("invert", False))
        grayscale: bool = bool(params.get("grayscale", True))

        # ------------------------------------------------------------------
        # 3. Grayscale conversion
        # ------------------------------------------------------------------
        if grayscale and len(img.shape) > 2 and img.shape[2] > 1:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        elif len(img.shape) == 2:
            # Already single-channel
            gray = img
        else:
            # Multi-channel but grayscale not requested – still need
            # single-channel for edge detection algorithms.
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # ------------------------------------------------------------------
        # 4. Gaussian blur (ensure kernel size is odd)
        # ------------------------------------------------------------------
        if blur_kernel_size % 2 == 0:
            blur_kernel_size += 1
        blurred = cv2.GaussianBlur(gray, (blur_kernel_size, blur_kernel_size), 0)

        # ------------------------------------------------------------------
        # 5. Edge detection
        # ------------------------------------------------------------------
        if algorithm == "canny":
            if low_threshold >= high_threshold:
                raise ValueError("low_threshold must be less than high_threshold")
            edges = cv2.Canny(blurred, low_threshold, high_threshold)

        elif algorithm == "sobel":
            sobel_x = cv2.Sobel(blurred, cv2.CV_64F, 1, 0, ksize=kernel_size)
            sobel_y = cv2.Sobel(blurred, cv2.CV_64F, 0, 1, ksize=kernel_size)
            magnitude = np.abs(sobel_x) + np.abs(sobel_y)
            # Normalize to 0-255 and convert to uint8
            magnitude = np.clip(magnitude / magnitude.max() * 255, 0, 255).astype(
                np.uint8
            ) if magnitude.max() > 0 else magnitude.astype(np.uint8)
            _, edges = cv2.threshold(magnitude, 127, 255, cv2.THRESH_BINARY)

        elif algorithm == "laplacian":
            laplacian = cv2.Laplacian(blurred, cv2.CV_64F, ksize=kernel_size)
            abs_laplacian = np.abs(laplacian)
            abs_laplacian = np.clip(
                abs_laplacian / abs_laplacian.max() * 255, 0, 255
            ).astype(np.uint8) if abs_laplacian.max() > 0 else abs_laplacian.astype(
                np.uint8
            )
            _, edges = cv2.threshold(abs_laplacian, 127, 255, cv2.THRESH_BINARY)

        else:
            raise ValueError(f"Unknown algorithm: {algorithm}")

        # ------------------------------------------------------------------
        # 6. Optional inversion
        # ------------------------------------------------------------------
        if invert:
            edges = cv2.bitwise_not(edges)

        # ------------------------------------------------------------------
        # 7. Find contours
        # ------------------------------------------------------------------
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

        # ------------------------------------------------------------------
        # 8. Simplify & filter contours, then build PATH objects
        # ------------------------------------------------------------------
        path_list: list[dict[str, Any]] = []

        for contour in contours:
            # Douglas-Peucker polygon approximation
            approx = cv2.approxPolyDP(contour, simplification_tolerance, True)

            # Filter by minimum arc-length
            arc_len = cv2.arcLength(approx, True)
            if arc_len < min_contour_length:
                continue

            # Extract (x, y) points from the Nx1x2 contour array
            points = approx.reshape(-1, 2).tolist()

            if len(points) < 2:
                continue

            # Determine if the contour is closed (first ≈ last within 1px)
            first = points[0]
            last = points[-1]
            dist = math.hypot(first[0] - last[0], first[1] - last[1])
            closed = dist <= 1.0

            # Build line segments between consecutive points
            segments: list[dict[str, Any]] = []
            for i in range(len(points) - 1):
                segments.append(
                    {
                        "type": "line",
                        "from": points[i],
                        "to": points[i + 1],
                        "meta": {"width": None, "speed": None},
                    }
                )

            # If closed, add closing segment from last point back to first
            if closed:
                segments.append(
                    {
                        "type": "line",
                        "from": points[-1],
                        "to": points[0],
                        "meta": {"width": None, "speed": None},
                    }
                )

            path_list.append(
                {
                    "segments": segments,
                    "closed": closed,
                }
            )

        # ------------------------------------------------------------------
        # 9. Return PATH output
        # ------------------------------------------------------------------
        return {"path": path_list}


Plugin = EdgeDetection
