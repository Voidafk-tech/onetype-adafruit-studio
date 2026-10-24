#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -x build/onetype-ontology ] || [ cpp/server.cpp -nt build/onetype-ontology ] || [ cpp/pipeline.cpp -nt build/onetype-ontology ] || [ cpp/pipeline.hpp -nt build/onetype-ontology ] || [ third_party/httplib.h -nt build/onetype-ontology ] || [ third_party/nlohmann/json.hpp -nt build/onetype-ontology ]; then
  sh build.sh
fi
exec ./build/onetype-ontology "$@"
