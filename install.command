#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "FORMFORGE — one-time local AI setup"
echo "Allow at least 25 GB free disk space. First setup can take a while."
PYTHON=""
for candidate in python3.12 python3.11 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    VERSION=$("$candidate" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    MAJOR=${VERSION%%.*}; MINOR=${VERSION#*.}
    if [ "$MAJOR" -eq 3 ] && [ "$MINOR" -ge 10 ] && [ "$MINOR" -le 12 ]; then PYTHON="$candidate"; break; fi
  fi
done
if [ -z "$PYTHON" ]; then
  echo "Python 3.10+ required. Install Python 3.12 from https://www.python.org/downloads/macos/ and rerun."
  exit 1
fi
command -v git >/dev/null 2>&1 || { echo "Git is required. Install Xcode Command Line Tools with: xcode-select --install"; exit 1; }
[ -d .venv ] || "$PYTHON" -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip wheel
python -m pip install fastapi uvicorn python-multipart mlx mlx-arsenal safetensors Pillow trimesh scikit-image PyMCubes scipy 'numpy<2' huggingface_hub hf_xet xatlas opencv-python pyyaml einops transformers==4.46.0 diffusers==0.30.0 accelerate pytorch-lightning imageio pandas rembg realesrgan pymeshlab pygltflib omegaconf configargparse tqdm psutil timm torchdiffeq torchmetrics basicsr
python -m pip install torch torchvision
mkdir -p .local-engine
if [ ! -d .local-engine/Hunyuan3D-2.1-mlx/.git ]; then
  git clone --depth 1 https://github.com/dgrauet/Hunyuan3D-2.1-mlx.git .local-engine/Hunyuan3D-2.1-mlx
fi
echo "Setup complete. Run: bash start.command"
echo "The first generation downloads model weights from Hugging Face."
