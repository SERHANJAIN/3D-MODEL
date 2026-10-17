# FormForge Studio — Image to 3D

FormForge turns a reference image into a detailed, textured 3D asset and lets you inspect and export the resulting GLB.

## Repository layout

The browser files intentionally live at the **repository root** so they work with GitHub's web uploader and GitHub Pages. Keep `index.html`, `styles.css`, and `app.js` side by side; do not move them into `public/`.

- `index.html` — workspace UI and API-base configuration
- `styles.css` — responsive studio design
- `app.js` — image upload, Three.js preview, generation progress, and export
- `server.js` — secure Meshy API proxy (server-side key only)
- `.env.example` — local environment template
- `render.yaml` — Render API service blueprint

The frontend uses relative asset paths (`./styles.css` and `./app.js`) so the site's `/3D-MODEL/` project path is respected rather than incorrectly looking for files at the domain root.

## Important: GitHub Pages cannot run the AI backend

GitHub Pages hosts the static interface and 3D preview. AI generation and GLB downloads require `server.js` to run on a Node.js host.

### Deploy the backend

1. Create a key on the [Meshy developer platform](https://www.meshy.ai/).
2. Open [Render](https://render.com/) and create a **Blueprint** from this repository using `render.yaml`, or create a Node web service manually with build command `npm install` and start command `npm start`.
3. Add `MESHY_API_KEY` as a private environment secret. Do not put your key in `index.html` or `app.js`. The blueprint prompts for the key and permits the GitHub Pages origin via `FRONTEND_ORIGINS`.
4. Copy your deployed service base URL (such as `https://your-service.onrender.com`) and replace the empty `formforge-api-base` meta tag in `index.html` with:
   ```html
   <meta name="formforge-api-base" content="https://your-service.onrender.com">
   ```
   Do **not** add `/api` to the end. The browser code adds the endpoint path automatically.
5. Commit the HTML update. When GitHub Pages redeploys, refresh the site. The top status should report **ENGINE CONNECTED** when the API and secret are configured.

### Run locally

Requires Node.js 20 or newer. Copy `.env.example` to `.env`, set `MESHY_API_KEY`, then run:

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Included features

- PNG, JPG/JPEG, and WebP image upload (up to 20 MB)
- 2K High Detail / 4K Ultra Detail options
- Optional material direction prompt and texture/PBR toggles
- Live Meshy task status and a Three.js model preview
- Orbit, zoom, reset camera, and auto-rotate
- GLB export streamed via the server
- Server-side provider key, generation rate limiting, and allowlisted CORS origins

Generation quality depends on the source image and the provider model. A single photo cannot reveal every hidden surface accurately. Provider credits may be charged for each generation; check current pricing before large batches.

## Before going public

Add authentication, per-user quotas, durable task ownership/storage, upload abuse controls, spending limits, and monitoring. The in-memory task allowlist in this starter app is intended for a single API instance.
