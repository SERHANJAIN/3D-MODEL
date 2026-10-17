import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.MESHY_API_KEY?.trim();
const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';
const createdTasks = new Set();

app.disable('x-powered-by');
app.use(helmet({
  // Three.js modules are loaded from jsDelivr; the viewer also downloads the model from this origin.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://assets.meshy.ai", "https://api.meshy.ai"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const generationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 4,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many generation requests. Please wait a minute and try again.' }
});

function apiErrorMessage(data, fallback) {
  return data?.message || data?.error || data?.detail || fallback;
}

async function meshyRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    const detail = apiErrorMessage(data, `Meshy returned HTTP ${response.status}`);
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }
  return data;
}

function taskIdIsValid(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9-]{8,100}$/.test(id) && createdTasks.has(id);
}

app.get('/api/config', (_req, res) => {
  res.json({ configured: Boolean(API_KEY), provider: 'Meshy', maxImageMB: 20 });
});

app.post('/api/generate', generationLimiter, async (req, res) => {
  if (!API_KEY) {
    return res.status(503).json({
      error: 'AI generation is not connected yet. Add your Meshy API key to the .env file and restart the server.'
    });
  }

  const { imageData, quality = '2k', texturePrompt = '', texture = true, pbr = true } = req.body || {};
  if (typeof imageData !== 'string' || !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(imageData)) {
    return res.status(400).json({ error: 'Upload a PNG, JPG, or WebP image to start.' });
  }
  const encoded = imageData.split(',')[1] || '';
  const approximateBytes = Math.floor(encoded.length * 3 / 4);
  if (approximateBytes > 20 * 1024 * 1024) {
    return res.status(413).json({ error: 'This image is larger than 20 MB. Please choose a smaller image.' });
  }
  if (!['2k', '4k'].includes(quality)) {
    return res.status(400).json({ error: 'Choose either 2K or 4K detail.' });
  }
  if (typeof texturePrompt !== 'string' || texturePrompt.length > 800) {
    return res.status(400).json({ error: 'The material prompt must be 800 characters or fewer.' });
  }

  try {
    const payload = {
      image_url: imageData,
      ai_model: 'meshy-7.1',
      model_type: 'standard',
      geometry_resolution: quality,
      texture_resolution: quality,
      should_texture: texture !== false,
      enable_pbr: texture !== false && pbr !== false,
      // Meshy's docs recommend disabling remeshing for the highest-detail surface.
      should_remesh: false,
      target_formats: ['glb'],
      image_enhancement: true
    };
    if (texture !== false && texturePrompt.trim()) payload.texture_prompt = texturePrompt.trim();
    const data = await meshyRequest(`${MESHY_BASE}/image-to-3d`, {
      method: 'POST', body: JSON.stringify(payload)
    });
    const id = data.result || data.id;
    if (!id) throw new Error('The generation service did not return a task ID.');
    createdTasks.add(id);
    res.json({ taskId: id, status: 'PENDING', progress: 0 });
  } catch (error) {
    const upstreamStatus = error.status || 502;
    const publicStatus = [400, 401, 402, 429].includes(upstreamStatus) ? upstreamStatus : 502;
    res.status(publicStatus).json({ error: error.message || 'Could not start generation. Check your API configuration and try again.' });
  }
});

app.get('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  if (!taskIdIsValid(id)) return res.status(404).json({ error: 'Task not found in this session.' });
  if (!API_KEY) return res.status(503).json({ error: 'Meshy API key is not configured.' });
  try {
    const task = await meshyRequest(`${MESHY_BASE}/image-to-3d/${encodeURIComponent(id)}`);
    const status = task.status || 'IN_PROGRESS';
    const glbReady = status === 'SUCCEEDED' && Boolean(task.model_urls?.glb);
    res.json({
      taskId: id,
      status,
      progress: Number(task.progress || (glbReady ? 100 : 0)),
      previewUrl: task.thumbnail_url || task.thumbnail_urls?.front || null,
      modelReady: glbReady,
      consumedCredits: task.consumed_credits ?? null,
      error: status === 'FAILED' || status === 'CANCELED' ? (task.task_error?.message || `Generation ${status.toLowerCase()}.`) : null
    });
  } catch (error) {
    res.status(error.status && error.status < 500 ? error.status : 502).json({ error: error.message || 'Could not check generation status.' });
  }
});

app.get('/api/model/:id', async (req, res) => {
  const { id } = req.params;
  if (!taskIdIsValid(id)) return res.status(404).json({ error: 'Model not found in this session.' });
  if (!API_KEY) return res.status(503).json({ error: 'Meshy API key is not configured.' });
  try {
    const task = await meshyRequest(`${MESHY_BASE}/image-to-3d/${encodeURIComponent(id)}`);
    if (task.status !== 'SUCCEEDED' || !task.model_urls?.glb) {
      return res.status(409).json({ error: 'The GLB model is not ready yet.' });
    }
    const upstream = await fetch(task.model_urls.glb);
    if (!upstream.ok || !upstream.body) throw new Error('Could not download the generated GLB from the provider.');
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="formforge-${id}.glb"`);
    }
    if (upstream.headers.get('content-length')) res.setHeader('Content-Length', upstream.headers.get('content-length'));
    const { Readable } = await import('node:stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    if (!res.headersSent) res.status(502).json({ error: error.message || 'Could not retrieve the GLB model.' });
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`FormForge is running at http://localhost:${PORT}`);
  console.log(`Meshy API ${API_KEY ? 'configured' : 'not configured — add MESHY_API_KEY to .env to enable generation'}.`);
});
