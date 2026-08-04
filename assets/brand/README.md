# Syllabus Sync brand assets

`source/` holds the official artwork exactly as supplied. **Never edit these files.**
Everything served to browsers is derived from them.

## Regenerating

```bash
python3 tools/brand/build_brand_assets.py
```

Requires Pillow and numpy (`pip install pillow numpy`). It is a developer tool, not a
build step — the outputs are committed.

Outputs land in `public/brand/` (web logos + `og-image.png`), `public/icons/`
(PWA icons), `public/apple-touch-icon.png` and `app/favicon.ico`.

## What the generator does

The supplied artwork is opaque RGB on a flat warm off-white with generous, uneven
padding. No logo pixel is redrawn, recoloured, stretched or cropped; the script only:

1. keys the flat background to alpha using a **border-connected flood fill**, so
   near-white areas *enclosed* by the mark (the dragon's eye, the strokes in its
   crest, the lion's highlight) stay opaque while the surrounding background goes
   transparent;
2. **colour-decontaminates** anti-aliased edge pixels by un-compositing
   `C = a·F + (1−a)·BG`, so no warm fringe survives on other surfaces;
3. trims padding to the artwork bounds and re-applies deliberate, symmetric clear space;
4. re-centres the logomark on a square canvas for app icons — neither supplied
   "square" file contains centred square artwork, so a direct resize produced an
   off-centre favicon.

## Notes

- `Syllabus_Sync_Logo_Banner_Wide.png` and `..._Banner_Wide_Alt.png` are
  **byte-identical**. Only one derivative is shipped; the `wideAlt` variant in
  `lib/brand.ts` resolves to the same file so callers can still express intent.
- The white shape threading between the lion and the dragon is **negative space** —
  it is the background showing through, not painted white. On dark surfaces it
  therefore disappears and the mark loses its structure, so app placements use
  `<BrandLogo tile />`, which composites the artwork over the warm brand backdrop.
- Use `components/brand/BrandLogo.tsx` rather than raw `<Image>` tags.
