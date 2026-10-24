#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p build
"${CXX:-c++}" -std=c++17 -O2 -pthread -Wall -Wextra -Ithird_party -Icpp cpp/pipeline.cpp cpp/pipeline_test.cpp -lcurl -o build/pipeline-test
./build/pipeline-test
