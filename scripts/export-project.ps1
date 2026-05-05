$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ExportRoot = Join-Path $ProjectRoot "exports"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ZipPath = Join-Path $ExportRoot "rpa-chatflow-$Stamp.zip"

New-Item -ItemType Directory -Force -Path $ExportRoot | Out-Null

$items = @(
  "app.py",
  "README.md",
  "OAUTH_SETUP.md",
  "INSTALL.md",
  "PROJECT_MANIFEST.md",
  "requirements.txt",
  ".env.example",
  ".gitignore",
  "chatbot",
  "static",
  "data\flows.json",
  "scripts"
)

$temp = Join-Path $env:TEMP "rpa-chatflow-export-$Stamp"
New-Item -ItemType Directory -Force -Path $temp | Out-Null

foreach ($item in $items) {
  $source = Join-Path $ProjectRoot $item
  if (Test-Path $source) {
    $target = Join-Path $temp $item
    $parent = Split-Path -Parent $target
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -Path $source -Destination $target -Recurse -Force
  }
}

Compress-Archive -Path (Join-Path $temp "*") -DestinationPath $ZipPath -Force
Remove-Item -Recurse -Force $temp

Write-Host "Exported: $ZipPath"
