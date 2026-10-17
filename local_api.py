from __future__ import annotations
import gc, sys, time, uuid
from pathlib import Path
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / ".local-engine" / "Hunyuan3D-2.1-mlx"
OUTPUT_DIR = ROOT / "generated"
OUTPUT_DIR.mkdir(exist_ok=True)
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_IMAGES = 4
QUALITY_PRESETS = {
    "low": {"steps": 18, "resolution": 128, "texture_size": 512, "render_size": 512},
    "medium": {"steps": 28, "resolution": 192, "texture_size": 1024, "render_size": 768},
    "high": {"steps": 35, "resolution": 256, "texture_size": 2048, "render_size": 1024},
    "extreme": {"steps": 50, "resolution": 320, "texture_size": 2048, "render_size": 1024},
}
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

def load_paint_pipeline(preset):
    global paint_pipeline
    if paint_pipeline is None:
        sys.path.insert(0, str(MODEL_DIR))
        sys.path.insert(0, str(MODEL_DIR / "hy3dpaint"))
        from textureGenPipeline_mlx import Hunyuan3DPaintConfigMLX, Hunyuan3DPaintPipelineMLX
        config = Hunyuan3DPaintConfigMLX(max_num_view=4, resolution=256)
        config.render_size = preset["render_size"]
        config.texture_size = preset["texture_size"]
        paint_pipeline = Hunyuan3DPaintPipelineMLX(config)
    return paint_pipeline

def make_reference_sheet(files, job_dir):
    """Arrange selected views into a contact sheet; this model currently accepts one image."""
    import io
    tiles=[]
    for idx,(filename,data) in enumerate(files,start=1):
        try:
            with Image.open(io.BytesIO(data)) as opened:
                img=ImageOps.exif_transpose(opened).convert("RGB")
                img.thumbnail((760,740),Image.Resampling.LANCZOS)
                tile=Image.new("RGB",(800,800),"white")
                tile.paste(img,((800-img.width)//2,45+(740-img.height)//2))
                ImageDraw.Draw(tile).text((14,12),f"VIEW {idx}: {filename[:50]}",fill="black")
                tiles.append(tile)
        except Exception as exc:
            raise HTTPException(status_code=400,detail=f"Could not read image {filename}: {exc}") from exc
    if len(tiles)==1:
        target=job_dir/"source.png"; tiles[0].save(target,format="PNG",optimize=True); return target
    sheet=Image.new("RGB",(1600,1600),"#e8e8e8")
    for i,tile in enumerate(tiles): sheet.paste(tile,((i%2)*800,(i//2)*800))
    target=job_dir/"references.png"; sheet.save(target,format="PNG",optimize=True); return target

@app.post("/api/generate")
def generate(images: list[UploadFile] = File(...), quality: str = Form("medium"), texture: bool = Form(True), pbr: bool = Form(True), material_prompt: str = Form("")):
    if not images or len(images)>MAX_IMAGES: raise HTTPException(status_code=400,detail="Upload between 1 and 4 images of the same object.")
    quality=quality if quality in QUALITY_PRESETS else "medium"; preset=QUALITY_PRESETS[quality]
    file_data=[]; total_bytes=0
    for image in images:
        if (image.content_type or "").lower() not in {"image/jpeg","image/png","image/webp"}: raise HTTPException(status_code=400,detail="Choose JPG, PNG or WebP images.")
        data=image.file.read(MAX_IMAGE_BYTES+1)
        if len(data)>MAX_IMAGE_BYTES: raise HTTPException(status_code=413,detail="Each image must be 20 MB or smaller.")
        total_bytes+=len(data)
        if total_bytes>50*1024*1024: raise HTTPException(status_code=413,detail="Combined image size must be 50 MB or smaller.")
        file_data.append((image.filename or f"view-{len(file_data)+1}",data))
    job_id=uuid.uuid4().hex; job_dir=OUTPUT_DIR/job_id; job_dir.mkdir(parents=True,exist_ok=True)
    image_path=make_reference_sheet(file_data,job_dir); shape_path=job_dir/"shape.glb"; textured_obj=job_dir/"textured.obj"
    try:
        pipe=load_shape_pipeline()
        mesh=pipe(str(image_path),num_inference_steps=preset["steps"],guidance_scale=5.5,octree_resolution=preset["resolution"],seed=int(time.time())%2**31)
        mesh.export(str(shape_path)); del mesh
        global shape_pipeline
        del shape_pipeline; shape_pipeline=None; gc.collect()
        try:
            import mlx.core as mx
            mx.clear_cache()
        except Exception: pass
        final_path=shape_path
        if texture:
            paint=load_paint_pipeline(preset)
            paint(mesh_path=str(shape_path),image_path=str(image_path),output_mesh_path=str(textured_obj),use_remesh=(quality in {"high","extreme"}),save_glb=True)
            textured_glb=textured_obj.with_suffix(".glb")
            if not textured_glb.exists():
                candidates=[p for p in job_dir.glob("*.glb") if p!=shape_path]
                if not candidates: raise RuntimeError("Texture stage finished but did not create a GLB file.")
                textured_glb=max(candidates,key=lambda p:p.stat().st_mtime)
            final_path=textured_glb
        return {"modelUrl":f"/outputs/{job_id}/{final_path.name}","textured":bool(texture),"pbr":bool(pbr),"quality":quality,"inputImages":len(file_data)}
    except HTTPException: raise
    except Exception as exc:
        print(f"[FormForge generation error] {type(exc).__name__}: {exc}",flush=True)
        raise HTTPException(status_code=500,detail=f"Local generation failed ({type(exc).__name__}: {exc}). Check Terminal. If texture generation runs out of memory, turn textures off and retry.") from exc

app.mount("/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="outputs")
app.mount("/", StaticFiles(directory=str(ROOT), html=True), name="site")
