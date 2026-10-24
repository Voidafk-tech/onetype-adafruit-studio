#!/bin/sh
# Builds the engine and the studio catalog index if needed, then serves the studio UI.
set -eu
cd "$(dirname "$0")"
PORT="${PORT:-4181}"
if [ ! -x build/adafruit-engine ] || [ cpp/engine.cpp -nt build/adafruit-engine ] || [ cpp/pipeline.cpp -nt build/adafruit-engine ] || [ cpp/engine_server.cpp -nt build/adafruit-engine ]; then
  sh build-engine.sh
fi
if [ ! -f dist/studio/data/catalog.json ] || [ data/workspace.json -nt dist/studio/data/catalog.json ]; then
  node scripts/build-studio-catalog.mjs
fi
echo "OneType Studio: http://127.0.0.1:${PORT}/assets/studio/"
exec ./build/adafruit-engine --port "$PORT" "$@"
