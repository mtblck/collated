# Collated brand

The Collated name, logo and brand kit. None of it is under the code's MIT
licence: see [LICENSE](LICENSE) and [TRADEMARKS.md](TRADEMARKS.md) (ADR 0033).

The mark is the stacked pages Collated has always used, redrawn on a 256
grid by the `brand-kit` plugin (1.8.0, from `mtblck/claude-marketplace`) in
the app's own colours: Ink and Amber on light, Chalk and Lamp on the dark
light table. The name is lower case Geist SemiBold, as in the header.

| File                 | What it is                                                                              |
| -------------------- | --------------------------------------------------------------------------------------- |
| `draw.mjs`           | Draws the mark, favicon and lockups and writes `brand.json`. Edit this, never the SVGs. |
| `portfolio/draw.mjs` | Draws the case-study and Ko-fi covers.                                                  |
| `brand.json`         | Colours, type, logos, icons and which parts of the kit to make.                         |
| `*.svg`              | The logo sources the kit is exported from.                                              |
| `dist/`              | The exported kit (not committed: it's rebuilt from the above).                          |

## Rebuilding the kit

With the plugin installed (`/plugin marketplace add mtblck/claude-marketplace`,
then `/plugin install brand-kit@mtblck`), set `BRAND_KIT` to the installed
version's `skills/logo` folder (the scripts read it, and fall back to 1.8.0):

```sh
export BRAND_KIT=$(ls -d ~/.claude/plugins/cache/mtblck/brand-kit/*/skills/logo | sort -V | tail -1)
node brand/draw.mjs && node brand/portfolio/draw.mjs
node $BRAND_KIT/scripts/export.mjs brand/brand.json
```

`brand/dist/` then holds the guidelines PDF, logos in SVG, PNG and PDF,
icons, the website palette, social images, templates, portfolio art and
`collated-brand-kit.zip` with all of it.

The site's icons come from the kit. After changing the mark, copy them in:

```sh
cp brand/favicon.svg public/favicon.svg
for f in apple-touch-icon icon-192 icon-512 icon-maskable-512; do
  cp brand/dist/icons/$f.png public/icons/$f.png
done
```
