from __future__ import annotations
import gc, sys, time, uuid
from pathlib import Path
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / ".local-engine" / "Hunyuan3D-2.1-mlx"
OUTPUT_DIR = ROOT / "generated"
OUTPUT_DIR.mkdir(exist_ok=True)
MAX_IMAGE_BYTES = 20 * 1024 * 1024
app = FastAPI(title="FormForge Local Engine")
shape_pipeline = None
paint_pipeline = None

@app.get("/api/health")
def health():
    return {"ready": MODEL_DIR.exists(), "mode": "local", "message": "Local Apple Silicon engine"}

def load_shape_pipeline():
    global shape_pipeline
    if shape_pipeline is None:
        if not MODEL_DIR.exists():
            raise RuntimeError("Local model code is missing. Run bash install.command from the FormForge folder.")
        sys.path.insert(0, str(MODEL_DIR))
        sys.path.insert(0, str(MODEL_DIR / "hy3dshape"))
        from hy3dshape.pipeline_mlx import ShapePipeline
        shape_pipeline = ShapePipeline.from_pretrained("dgrauet/hunyuan3d-2.1-mlx")
    return shape_pipeline

def load_paint_pipeline():
    global paint_pipeline
    if paint_pipeline is None:
        sys.path.insert(0, str(MODEL_DIR))
        sys.path.insert(0, str(MODEL_DIR / "hy3dpaint"))
        from textureGenPipeline_mlx import Hunyuan3DPaintConfigMLX, Hunyuan3DPaintPipelineMLX
        config = Hunyuan3DPaintConfigMLX(max_num_view=4, resolution=256)
        config.render_size = 1024
        config.texture_size = 2048
        paint_pipeline = Hunyuan3DPaintPipelineMLX(config)
    return paint_pipeline

@app.post("/api/generate")
def generate(image: UploadFile = File(...), quality: str = Form("2k"), texture: bool = Form(True), pbr: bool = Form(True), material_prompt: str = Form("")):
    content_type = (image.content_type or "").lower()
    if content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=400, detail="Choose a JPG, PNG or WebP image.")
    data = image.file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 20 MB or smaller.")
    job_id = uuid.uuid4().hex
    job_dir = OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    suffix = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[content_type]
    image_path, shape_path = job_dir / f"source{suffix}", job_dir / "shape.glb"
    textured_obj = job_dir / "textured.obj"
    image_path.write_bytes(data)
    try:
        pipe = load_shape_pipeline()
        mesh = pipe(str(image_path), num_inference_steps=35 if quality == "2k" else 50,
                    guidance_scale=5.5, octree_resolution=256 if quality == "2k" else 320,
                    seed=int(time.time()) % 2**31)
        mesh.export(str(shape_path))
        del mesh
        global shape_pipeline
        del shape_pipeline
        shape_pipeline = None
        gc.collect()
        try:
            import mlx.core as mx
            mx.clear_cache()
        except Exception:
            pass
        final_path = shape_path
        if texture:
            paint = load_paint_pipeline()
            paint(mesh_path=str(shape_path), image_path=str(image_path),
                  output_mesh_path=str(textured_obj), use_remesh=True, save_glb=True)
            textured_glb = textured_obj.with_suffix(".glb")
            if not textured_glb.exists():
                candidates = [p for p in job_dir.glob("*.glb") if p != shape_path]
                if not candidates:
                    raise RuntimeError("Texture stage finished but did not create a GLB file.")
                textured_glb = max(candidates, key=lambda p: p.stat().st_mtime)
            final_path = textured_glb
        return {"modelUrl": f"/outputs/{job_id}/{final_path.name}", "textured": bool(texture), "pbr": bool(pbr)}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[FormForge generation error] {type(exc).__name__}: {exc}", flush=True)
        raise HTTPException(status_code=500, detail=f"Local generation failed ({type(exc).__name__}: {exc}). Check Terminal. If texture generation runs out of memory, turn textures off and retry.") from exc

app.mount("/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="outputs")
app.mount("/", StaticFiles(directory=str(ROOT), html=True), name="site")
