#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then echo "Run bash install.command first."; exit 1; fi
source .venv/bin/activate
echo "FormForge local AI: http://127.0.0.1:8765"
echo "Keep this Terminal window open. Press Ctrl+C to stop."
open http://127.0.0.1:8765
python -m uvicorn local_api:app --host 127.0.0.1 --port 8765
