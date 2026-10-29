@echo off
start "" http://localhost:8777
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
