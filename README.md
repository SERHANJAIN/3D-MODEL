# FormForge Studio — Free Local Image-to-3D

FormForge's website can run on GitHub Pages, but the AI generation engine runs on your own Apple Silicon Mac. This avoids shared demo quotas and paid API keys. Your Mac must be on and the local server running during generation.

## Mac setup

1. Download this repository using **Code → Download ZIP** and unzip it, or clone it.
2. Open Terminal and change into the unzipped `3D-MODEL` folder.
3. Run the one-time setup:
   ```bash
   bash install.command
   ```
4. Start FormForge whenever you want to generate:
   ```bash
   bash start.command
   ```
5. Open `http://127.0.0.1:8765`. Upload an image and generate. Keep the Terminal window open.

Setup requires Python 3.10+, Git, and roughly 25 GB of free disk space. The first generation downloads model weights (several GB), so it needs an internet connection and can take a while. After weights are cached, inference runs locally. The 18 GB Mac preset reduces texture/render resolution to help manage unified memory. If texture generation runs out of memory, turn off **Photorealistic texture** to generate the shape-only GLB.

## Free and local

- No paid API key, subscription, or shared public-demo quota.
- Images are processed by the local engine on your Mac.
- Generation speed and quality depend on the image and available memory.
- The Mac must stay awake and the local engine must stay running.
- The AI model's license and use restrictions still apply; see the upstream model repository.

## Model

Apple Silicon MLX port of Hunyuan3D-2.1: https://github.com/dgrauet/Hunyuan3D-2.1-mlx

The public GitHub Pages URL is only the static interface. For generation without a cloud API, open the local address above instead.
