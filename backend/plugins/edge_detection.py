"""Edge Detection plugin – converts raster images into PATH-format line segments
using configurable computer-vision algorithms (Canny, Sobel, or Laplacian).
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
    """Detects edges in a raster image and converts contours into PATH-format
    line segments suitable for plotter output."""

    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="Edge Detection",
            category="Processing",
            description=(
                "Detects edges in a raster image using configurable computer-vision "
                "algorithms (Canny, Sobel, or Laplacian) and converts the resulting "
                "contours into PATH-format line segments. Supports pre-processing "
                "options such as grayscale conversion and Gaussian blur, plus "
                "post-processing controls for contour simplification and "
                "minimum-length filtering. Designed for converting photographic or "
                "raster artwork into plottable vector outlines."
            ),
            inputs=[
                PortDefinition(
                    name="image",
                    type=PortType.IMAGE,
                    description=(
                        "The source raster image (base64 PNG) to run edge detection on. "
                        "Accepts colour or grayscale input."
                    ),
                ),
            ],
            outputs=[
                PortDefinition(
                    name="path",
                    type=PortType.PATH,
                    description=(
                        "Detected edges expressed as PATH-format line segments. Each "
                        "contour from the image becomes one PathObject. Closed contours "
                        "have closed: true."
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
                        "The edge-detection algorithm to apply. Canny produces binary "
                        "edges using a double-threshold hysteresis approach and is best "
                        "for clean, well-defined contours. Sobel computes gradient "
                        "magnitude in both axes and is useful for emphasising directional "
                        "edges. Laplacian computes the second derivative and highlights "
                        "rapid intensity changes; it tends to produce thinner but noisier "
                        "edges."
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
                        "Canny only. The lower hysteresis threshold. Pixels with gradient "
                        "magnitude below this value are rejected. Lower values include "
                        "more subtle edges but increase noise. Ignored when algorithm is "
                        "not Canny."
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
                        "Canny only. The upper hysteresis threshold. Pixels with gradient "
                        "magnitude above this value are accepted as strong edges "
                        "immediately. Ignored when algorithm is not Canny."
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
                        "Sobel and Laplacian. The size of the derivative kernel. Larger "
                        "kernels smooth noise but reduce spatial precision. Ignored when "
                        "algorithm is Canny."
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
                        "The size of the Gaussian blur kernel applied before edge "
                        "detection. Must be odd. Larger values smooth out noise at the "
                        "cost of edge sharpness. Set to 1 to disable blurring."
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
                        "The epsilon value for the Douglas-Peucker polygon approximation "
                        "(cv2.approxPolyDP). Higher values produce fewer, straighter "
                        "segments. Set to 0 to keep all contour points."
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
                        "The minimum arc-length in pixels a contour must span to be "
                        "included in output. Increase to filter out noise or tiny "
                        "artefacts."
                    ),
                ),
                ParameterDefinition(
                    name="invert",
                    type="boolean",
                    default=False,
                    description=(
                        "When enabled, the edge-detection output is bitwise-inverted "
                        "before contour extraction. Swaps foreground and background."
                    ),
                ),
                ParameterDefinition(
                    name="grayscale",
                    type="boolean",
                    default=True,
                    description=(
                        "When enabled, the input image is converted to single-channel "
                        "grayscale before processing. If already single-channel, this is "
                        "a no-op."
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
