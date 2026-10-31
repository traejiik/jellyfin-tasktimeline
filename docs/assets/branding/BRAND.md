# Task Timeline identity

Direction B: an open clock ring above three staggered schedule bars. The rounded geometry and indigo-to-lavender palette establish a family relationship with AniDoki. This artwork is constructed as editable SVG paths rather than a traced bitmap.

## Files

| Use | Artwork |
| --- | --- |
| README, full-width navy banner at 240 px high | `tasktimeline-banner.svg` |
| Navy-backed card, 1600 x 900 | `tasktimeline-card.svg` |
| Jellyfin catalog and bundled manual/local install artwork, padded horizontal logo on a 1600 x 900 navy card | `tasktimeline-catalog.svg` |
| Transparent horizontal logo master | `tasktimeline-horizontal.svg` |
| Square logo with navy background, 1024 x 1024 | `tasktimeline-logo.svg` |
| Transparent stacked logo | `tasktimeline-stacked.svg` |
| Wordmark only | `tasktimeline-wordmark.svg` |
| Primary symbol | `tasktimeline-symbol.svg` |
| Symbol for small sizes | `tasktimeline-symbol-small.svg` |
| Rounded navy app tile | `tasktimeline-icon.svg` |
| Unused raster exports, favicons, touch icon and monochrome variants | `generated/` (local, ignored) |
| Visual QA and context previews | `generated/brand-preview.png`, `generated/brand-preview.html`, `generated/brand-presentation.html` (local, ignored) |

All supplied files are preserved under `docs/assets/branding/`. Core SVG artwork, this guide and `OFL-Nunito.txt` remain tracked. Unused exports and preview files live in the ignored `generated/` directory; they are not included in a fresh clone. The original PNG card is unused; the catalog and packages use `tasktimeline-catalog.svg`.

SVG masters contain outlined lettering and filled shapes. No installed fonts, embedded raster artwork, masks, filters, or outline-stroke operation is required to display them. Raster exports use the SVG master as their source.

## Palette and typography

| Colour | HEX | RGB | Role |
| --- | --- | --- | --- |
| Indigo | `#4935F4` | 73, 53, 244 | Start of the primary symbol gradient |
| Periwinkle | `#747CFF` | 116, 124, 255 | Clock ring, Task wordmark |
| Lavender | `#A6ADFF` | 166, 173, 255 | Hands, final schedule bar, Timeline wordmark |
| Midnight | `#101623` | 16, 22, 35 | Card and logo backgrounds |

The wordmark is based on Nunito Black (weight 1000) with custom letter spacing, including an open Ti pair. All lettering is converted to paths; no font installation is necessary. Nunito is by the Nunito Project Authors under the SIL Open Font License 1.1; the notice is preserved in `OFL-Nunito.txt`. Source: https://github.com/google/fonts/tree/main/ofl/nunito.

## Usage

- Use `tasktimeline-catalog.svg` for the Jellyfin catalog and install packages. Its 16:9 navy canvas contains the unchanged horizontal logo at 75% of the card width, centered with padding. The raw horizontal master is too wide for Jellyfin’s desktop card crop. Use the navy banner with the stacked logo for the README.
- Prefer the full symbol at 48 px and above. Use the simplified two-bar symbol below 48 px; 24 px is preferred for UI use, while the 16 px favicon retains only the essential clock-and-bars reading.
- Use the horizontal lockup at 240 px wide or larger, and the stacked lockup at 160 px or larger. Use the standalone symbol below those sizes.
- Leave at least one schedule-bar thickness of clear space around the symbol, approximately 24 units on the 256-unit master grid, outside its visible shape. Built-in artboard padding is not the complete clear-space allowance.
- On light backgrounds, use the black variant; on busy surfaces, use the navy tile. The colour logo is intended primarily for dark backgrounds.
- Keep the artwork's aspect ratio. Do not add outlines, shadows, arrows, additional hands, textures, or remove bars from the primary mark. Use the supplied small-size cut instead.

## Verification and limits

The geometry was rendered and inspected twice. Refinements opened the ring-to-bar gap and the Ti pair. The final symbol was inspected in colour, black, white, and at 16, 24, 32, 48 and 64 px. The vector audit found no live text, raster images, unexpanded strokes, or filter/mask dependencies. It reports the intentional gradients and the higher anchor count of outlined wordmarks as warnings.

The reference-library check compared Moment.js and WakaTime clock marks: Task Timeline uses an open ring with external schedule bars rather than a complete circular enclosure. This is a design comparison, not trademark clearance. Printed colour matching and physical production have not been tested; this kit targets digital plugin use.

The README banner follows AniDōki's layout: a full-width navy background at a fixed 240 px height, with a centered 240 × 240 logo area. It embeds the unchanged `tasktimeline-stacked.svg` as a data image with explicit square dimensions and `preserveAspectRatio="xMidYMid meet"`. This replaces the old percentage-sized nested card viewport, keeping the clock and lettering proportional as the banner width changes. The standalone logo masters are unchanged; only the banner's layout wrapper is corrected.
