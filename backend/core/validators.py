"""Shared validators."""
from rest_framework import serializers

ALLOWED_IMAGE_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/heic",
    "image/heif",
    "image/bmp",
    "image/tiff",
    "image/svg+xml",
    "image/x-icon",
    "image/vnd.microsoft.icon",
}

MAX_IMAGE_SIZE_MB = 10


def validate_image_file(file):
    """
    Accept any image format.
    Tries Pillow first (covers JPEG, PNG, WebP, GIF, BMP, TIFF …).
    Falls back to content-type check for formats Pillow doesn't handle
    (AVIF, HEIC/HEIF, SVG, etc.).
    """
    if file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024:
        raise serializers.ValidationError(
            f"Image file too large. Maximum size is {MAX_IMAGE_SIZE_MB} MB."
        )

    content_type = getattr(file, "content_type", "") or ""

    try:
        from PIL import Image
        file.seek(0)
        Image.open(file).verify()
        file.seek(0)
        return file
    except Exception:
        pass

    if content_type.lower() in ALLOWED_IMAGE_CONTENT_TYPES or content_type.lower().startswith("image/"):
        file.seek(0)
        return file

    raise serializers.ValidationError(
        "Unsupported image format. Please upload a JPEG, PNG, WebP, GIF, AVIF, HEIC, BMP, TIFF, or SVG file."
    )
