# Arshad Portfolio

Interactive personal portfolio built with Vite, MapLibre GL, and Three.js.

## Highlights
- Globe/map-driven portfolio experience
- 3D text and 3D button objects rendered with Three.js
- Journey mode with animated path transitions
- Project detail modal and mobile-responsive overlays
- Keyboard interactions for journey control (`P` / `Esc`)

## Tech Stack
- Vite
- MapLibre GL JS
- Three.js
- Vanilla JavaScript + CSS

## Project Structure
- `index.html` - app shell and UI layers
- `script.js` - map lifecycle, journey flow, interaction logic
- `three-objects.js` - Three.js object creation/utilities
- `text-animations.js` - text animation helpers
- `style.css` - full styling (desktop + mobile)
- `public/` - fonts, route GeoJSON, and media assets

## Local Development
```bash
npm install
npm run dev
```

Default dev server:
- `http://localhost:3000`

## Build and Preview
```bash
npm run build
npm run preview
```

Build output is generated in `dist/`.

## Deployment (GitHub Pages)
This project is best hosted as a **user site**:
- Repository name: `<username>.github.io`
- Visibility: `Public`

Why: the app uses root/static asset patterns and map-heavy UI that are simplest to maintain at domain root.

## Git Workflow
Initial setup:
```bash
git init
git branch -M main
git add .
git commit -m "feat: launch v1 portfolio with 3D map journey and animated interface"
```

Regular updates:
```bash
git add .
git commit -m "<type>: <what changed>"
git push
```

Suggested commit types:
- `feat` new user-visible behavior
- `fix` bug fixes
- `chore` tooling/config cleanup
- `refactor` internal code improvements

## Notes
- Keep large videos/assets optimized before adding to `public/`.
- Do not commit local secrets (`.env*.local` is ignored).
