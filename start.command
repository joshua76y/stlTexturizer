#!/usr/bin/env bash
cd "$(dirname "$0")"
python3 serve.py &
sleep 2
open http://localhost:8080
