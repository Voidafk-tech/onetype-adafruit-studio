#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p build
"${CXX:-c++}" -std=c++17 -O2 -pthread -Wall -Wextra -Ithird_party -Icpp cpp/pipeline.cpp cpp/engine.cpp cpp/engine_test.cpp -lcurl -o build/engine-test
./build/engine-test
