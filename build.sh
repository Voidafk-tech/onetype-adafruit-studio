#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p build
"${CXX:-c++}" -std=c++17 -O2 -pthread -Wall -Wextra -Ithird_party cpp/server.cpp cpp/pipeline.cpp -lcurl -o build/onetype-ontology
echo "Built C++ ontology explorer."
