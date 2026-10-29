@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "try{(Invoke-WebRequest http://127.0.0.1:51810/health -UseBasicParsing -TimeoutSec 2)|Out-Null;exit 0}catch{exit 1}"
if %ERRORLEVEL% EQU 0 (
  start "" http://127.0.0.1:51810
  exit
)
start "Diario X" /min node server.mjs
rem espera o servidor responder (ate ~15 s) antes de abrir o navegador
powershell -NoProfile -Command "for($i=0;$i -lt 30;$i++){try{(Invoke-WebRequest http://127.0.0.1:51810/health -UseBasicParsing -TimeoutSec 1)|Out-Null;exit 0}catch{Start-Sleep -Milliseconds 500}};exit 1"
start "" http://127.0.0.1:51810
