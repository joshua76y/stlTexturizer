#!/usr/bin/env bash
cd "$(dirname "$0")"
python3 -m http.server 8080 &
sleep 2
open http://localhost:8080
