#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -x build/adafruit-engine ] || [ cpp/engine.cpp -nt build/adafruit-engine ] || [ cpp/engine.hpp -nt build/adafruit-engine ] || [ cpp/engine_server.cpp -nt build/adafruit-engine ] || [ cpp/pipeline.cpp -nt build/adafruit-engine ] || [ cpp/pipeline.hpp -nt build/adafruit-engine ]; then
  sh build-engine.sh
fi
exec ./build/adafruit-engine "$@"
