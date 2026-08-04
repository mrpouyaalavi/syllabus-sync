#!/usr/bin/env python3
"""Derive the web brand assets in public/brand from the originals in brand/source.

The supplied artwork is opaque RGB on a flat warm off-white with generous, uneven
padding. This script produces web-ready derivatives WITHOUT altering the logo
artwork itself:

  * the flat background is keyed to alpha using a border-connected flood fill,
    so enclosed near-white areas inside the mark are preserved;
  * anti-aliased edge pixels are colour-decontaminated (un-compositing
    C = a*F + (1-a)*BG) so no warm fringe survives on other surfaces;
  * padding is trimmed to the artwork bounds and re-applied as deliberate,
    symmetric clear space;
  * app icons re-centre the mark on a square canvas at the required sizes.

Nothing is redrawn, recoloured, stretched or cropped: the logo's own pixels and
aspect ratio are carried through untouched.

Run:  python3 tools/brand/build_brand_assets.py
"""

from __future__ import annotations

import sys
from collections import deque
from dataclasses import dataclass
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError:  # pragma: no cover - developer tooling only
    sys.exit("This script needs Pillow and numpy:  pip install pillow numpy")

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets" / "brand" / "source"
OUT = ROOT / "public" / "brand"
ICON_OUT = ROOT / "public" / "icons"
APP = ROOT / "app"
PUBLIC = ROOT / "public"

# Warm off-white carried by the supplied artwork; used as the opaque backdrop for
# app icons, which must not ship with transparency.
ICON_BACKDROP = (249, 240, 235)

# Alpha ramp thresholds, in RGB euclidean distance from the sampled background.
# Measured: background noise stays under ~10, the mark's interior whites sit at
# ~25, so a 12..20 ramp separates them cleanly.
SOLID_BG_MAX = 12.0
FULL_OPAQUE_MIN = 20.0


@dataclass(frozen=True)
class Derivative:
    source: str
    out: str
    # Clear space added back after trimming, as a fraction of the trimmed height.
    pad_ratio: float
    # Longest edge of the emitted file. Keeps served bytes sane while staying
    # well above 2x the largest on-screen render.
    max_edge: int


DERIVATIVES = (
    Derivative("Syllabus_Sync_Logo_Banner_Wide.png", "logo-wide.png", 0.06, 1600),
    Derivative("Syllabus_Sync_Logo_Primary_Horizontal.png", "logo-primary-horizontal.png", 0.06, 1400),
    Derivative("Syllabus_Sync_Wordmark_Banner_Wide.png", "wordmark-wide.png", 0.10, 1400),
    Derivative("Syllabus_Sync_Wordmark_Standard.png", "wordmark-standard.png", 0.10, 1200),
    Derivative("Syllabus_Sync_Logomark_Icon_Square.png", "logomark-square.png", 0.04, 900),
    Derivative("Syllabus_Sync_Logomark_Icon_CloseCrop.png", "logomark-close-crop.png", 0.02, 900),
)

# Social cards must be opaque (several platforms composite transparency onto
# black) and a predictable 1.91:1.
OG_SIZE = (1200, 630)

# name -> (pixel size, safe-area fraction of the canvas the mark may occupy).
# Matches the icon set already referenced by public/manifest.webmanifest.
ICONS = {
    "icon-192.png": (192, 0.80),
    "icon-384.png": (384, 0.80),
    "icon-512.png": (512, 0.80),
    # Maskable icons are cropped to a circle by some launchers, so the mark has
    # to sit inside the ~80% safe zone of an already padded canvas.
    "maskable-512.png": (512, 0.62),
    "apple-touch-icon.png": (180, 0.74),
}


def sample_background(rgb: np.ndarray) -> np.ndarray:
    """Median colour of a thin border ring, robust to artwork that bleeds to an edge."""
    band = 4
    ring = np.concatenate(
        [
            rgb[:band].reshape(-1, 3),
            rgb[-band:].reshape(-1, 3),
            rgb[:, :band].reshape(-1, 3),
            rgb[:, -band:].reshape(-1, 3),
        ]
    )
    return np.median(ring, axis=0)


def background_connected(mask: np.ndarray) -> np.ndarray:
    """Flood fill `mask` (True == background-like) inward from every border pixel.

    Only regions reachable from the canvas edge are treated as background, which
    is what keeps enclosed white counters inside the mark opaque.
    """
    h, w = mask.shape
    seen = np.zeros((h, w), dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    for x in range(w):
        for y in (0, h - 1):
            if mask[y, x] and not seen[y, x]:
                seen[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if mask[y, x] and not seen[y, x]:
                seen[y, x] = True
                queue.append((y, x))

    while queue:
        y, x = queue.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                queue.append((ny, nx))
    return seen


def cut_background(path: Path) -> Image.Image:
    """Return an RGBA image with the flat surrounding background keyed out."""
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
    bg = sample_background(rgb)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))

    # Generous mask for the flood fill so the anti-aliased rim is reachable,
    # then a ramp decides the actual alpha inside that region.
    region = background_connected(dist < FULL_OPAQUE_MIN)

    alpha = np.ones(dist.shape, dtype=np.float64)
    ramp = np.clip((dist - SOLID_BG_MAX) / (FULL_OPAQUE_MIN - SOLID_BG_MAX), 0.0, 1.0)
    alpha[region] = ramp[region]

    # Un-composite the edge pixels so no warm fringe is baked into the artwork.
    safe = np.maximum(alpha, 1e-6)[..., None]
    fg = (rgb - (1.0 - alpha)[..., None] * bg) / safe
    fg = np.where(alpha[..., None] > 0.995, rgb, fg)
    fg = np.clip(fg, 0, 255)

    out = np.dstack([fg, alpha * 255.0]).astype(np.uint8)
    return Image.fromarray(out).convert("RGBA")


def trim_to_alpha(image: Image.Image) -> Image.Image:
    bbox = image.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox is None:
        raise ValueError("image is fully transparent after keying")
    return image.crop(bbox)


def fit_within(image: Image.Image, max_edge: int) -> Image.Image:
    w, h = image.size
    longest = max(w, h)
    if longest <= max_edge:
        return image
    scale = max_edge / longest
    return image.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)


def with_clear_space(image: Image.Image, pad_ratio: float) -> Image.Image:
    pad = round(image.height * pad_ratio)
    if pad <= 0:
        return image
    canvas = Image.new("RGBA", (image.width + pad * 2, image.height + pad * 2), (0, 0, 0, 0))
    canvas.paste(image, (pad, pad))
    return canvas


def build_derivative(spec: Derivative) -> None:
    src = SOURCE / spec.source
    art = fit_within(trim_to_alpha(cut_background(src)), spec.max_edge)
    final = with_clear_space(art, spec.pad_ratio)
    dest = OUT / spec.out
    final.save(dest, format="PNG", optimize=True)
    print(f"  {spec.out:<32} {final.width}x{final.height}  {dest.stat().st_size / 1024:.0f} KB")


def build_icon(mark: Image.Image, size: int, safe: float, opaque: bool = True) -> Image.Image:
    """Centre `mark` inside a square canvas, occupying at most `safe` of the edge."""
    limit = size * safe
    scale = min(limit / mark.width, limit / mark.height)
    w, h = max(1, round(mark.width * scale)), max(1, round(mark.height * scale))
    art = mark.resize((w, h), Image.LANCZOS)

    background = (*ICON_BACKDROP, 255) if opaque else (0, 0, 0, 0)
    canvas = Image.new("RGBA", (size, size), background)
    canvas.alpha_composite(art, ((size - w) // 2, (size - h) // 2))
    return canvas.convert("RGB") if opaque else canvas


def main() -> None:
    if not SOURCE.is_dir():
        sys.exit(f"missing source directory: {SOURCE}")
    OUT.mkdir(parents=True, exist_ok=True)
    ICON_OUT.mkdir(parents=True, exist_ok=True)

    print("web assets:")
    for spec in DERIVATIVES:
        build_derivative(spec)

    # The full, untrimmed square logomark is the canonical mark for icons: the
    # close crop clips the artwork slightly, so it is not used as an icon source.
    mark = trim_to_alpha(cut_background(SOURCE / "Syllabus_Sync_Logomark_Icon_Square.png"))

    print("app icons:")
    for name, (size, safe) in ICONS.items():
        icon = build_icon(mark, size, safe)
        dest = ICON_OUT / name
        icon.save(dest, format="PNG", optimize=True)
        print(f"  {name:<32} {size}x{size}  {dest.stat().st_size / 1024:.0f} KB")

    # This app declares its icons explicitly in app/layout.tsx rather than using
    # the App Router icon file conventions, so the Apple touch icon is written to
    # the public root path that the metadata already points at.
    apple = build_icon(mark, 180, 0.74)
    apple.save(PUBLIC / "apple-touch-icon.png", format="PNG", optimize=True)
    print(f"  apple-touch-icon.png (public)    180x180  {(PUBLIC / 'apple-touch-icon.png').stat().st_size / 1024:.0f} KB")

    # Open Graph / Twitter card: the lockup centred on the brand backdrop with
    # generous margins so nothing is lost to platform cropping.
    lockup = trim_to_alpha(cut_background(SOURCE / "Syllabus_Sync_Logo_Banner_Wide.png"))
    card = Image.new("RGBA", OG_SIZE, (*ICON_BACKDROP, 255))
    limit_w, limit_h = OG_SIZE[0] * 0.62, OG_SIZE[1] * 0.42
    scale = min(limit_w / lockup.width, limit_h / lockup.height)
    art = lockup.resize((round(lockup.width * scale), round(lockup.height * scale)), Image.LANCZOS)
    card.alpha_composite(art, ((OG_SIZE[0] - art.width) // 2, (OG_SIZE[1] - art.height) // 2))
    card.convert("RGB").save(OUT / "og-image.png", format="PNG", optimize=True)
    print(f"  og-image.png                     {OG_SIZE[0]}x{OG_SIZE[1]}  {(OUT / 'og-image.png').stat().st_size / 1024:.0f} KB")

    # Kept in RGBA with a fully opaque alpha channel: Next's ICO decoder rejects
    # embedded PNGs that are not RGBA.
    favicon = build_icon(mark, 64, 0.86).convert("RGBA")
    favicon.save(
        APP / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
    )
    print(f"  favicon.ico                      multi-size  {(APP / 'favicon.ico').stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
