# Hush OS v0.35 Clean GitHub Build

This package is ready to upload to GitHub Pages.

## Structure

```text
index.html
src/
  styles.css
  app.js
assets/
  room-base.png
  hush-tv-asset.png
.nojekyll
```

## What changed in this clean build

- The large embedded base64 image data has been extracted into `/assets`.
- CSS and JavaScript have been split out of `index.html` for cleaner GitHub diffs.
- The old procedural room fallback has been removed.
- Plants, sofas, table/desk shell, aquarium and lantern procedural drawing code has been removed because those elements now live in the illustrated room asset.
- Dynamic systems are still live in canvas: window/city/weather, lamp, radio, TV, holocube, lighting, time-of-day, dev panel and ambient events.

## Dev panel

Press `Ctrl + Shift + D` in the browser to show the hidden developer panel.

## GitHub Pages

Upload these files to the root of your repo, then enable GitHub Pages for the repository branch. `index.html` should remain at the repo root.
