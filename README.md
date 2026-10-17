# FormForge Studio — Image to 3D

A dark, responsive image-to-3D workspace with image upload, a real-time Three.js viewer, high-detail Meshy generation, and GLB export.

## What works

- Drag-and-drop or browse for PNG, JPG/JPEG, and WebP images (up to 20 MB).
- Choose **2K High Detail** or **4K Ultra Detail** generation.
- Optional surface/material direction prompt.
- Polls real Meshy task progress, loads the resulting GLB in an interactive 3D viewer, and exports the original GLB through the server.
- Orbit, zoom, reset camera, and auto-rotate controls.
- API key is stored on the server in `.env`; it is never placed in browser JavaScript.
- Displays an honest setup state until the API key is configured.

## Start locally

Requires Node.js 20 or newer.

```bash
cp .env.example .env
# Edit .env and set MESHY_API_KEY to your key
npm install
npm start
```

Open `http://localhost:3000`.

Get a provider API key from [Meshy](https://www.meshy.ai/) / its developer platform. Generation uses the API credits associated with your Meshy account; check the provider's current pricing and limits before generating lots of assets.

## High-detail behavior

The app uses Meshy `meshy-7.1`, with `geometry_resolution` and `texture_resolution` matched to the selected 2K or 4K quality, PBR enabled, and remeshing disabled to preserve detail. It asks for GLB as the output format. The service works asynchronously, so the UI polls until the task finishes. The actual mesh quality, fidelity to unseen surfaces, and generation time depend on the source image and provider model; a single photo cannot guarantee a perfect reconstruction of hidden geometry.

Source: [Meshy Image to 3D API docs](https://docs.meshy.ai/en/api/image-to-3d).

## Deploy

Deploy the folder to any Node.js host that supports Node 20+. Configure `MESHY_API_KEY` as a server-side environment variable and `PORT` if your host provides one. Do not commit the `.env` file. The in-memory task allowlist is designed for a single-instance starter app; use a database/session-backed ownership model before running a public multi-user service behind multiple instances.

## Security and production notes

- The Express app adds security headers and rate-limits generation requests to reduce accidental spend.
- Do not expose the API key to the browser, commit it to Git, or share it in screenshots.
- For a public service, add authentication, per-user quotas/billing, durable task storage, upload abuse controls, provider spend limits, and operational monitoring.
- This is a starter application, not a hosted SaaS. You must provide and configure your own API account/key.
