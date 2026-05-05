$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

python -m py_compile app.py chatbot\config.py chatbot\db.py chatbot\facebook_oauth.py chatbot\flow_engine.py chatbot\messenger.py

$verifyToken = "rpa-chatflow-2026"
if (Test-Path ".env") {
  $line = Get-Content ".env" | Where-Object { $_ -match "^VERIFY_TOKEN=" } | Select-Object -First 1
  if ($line) {
    $verifyToken = $line -replace "^VERIFY_TOKEN=", ""
  }
}

Write-Host "Compile OK"
Write-Host "Run 'python app.py' in another terminal, then open:"
Write-Host "http://127.0.0.1:8000/webhook?hub.mode=subscribe&hub.verify_token=$verifyToken&hub.challenge=ok"
