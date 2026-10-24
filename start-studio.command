#!/bin/sh
cd "$(dirname "$0")" && (sleep 2 && open "http://127.0.0.1:4181/assets/studio/") & sh "$(dirname "$0")/run-studio.sh"
