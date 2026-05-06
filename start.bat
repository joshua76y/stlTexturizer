@echo off
cd /d "%~dp0"
start /B "" py -3 -m http.server 8080
ping -n 3 127.0.0.1 >nul
start "" http://localhost:8080
