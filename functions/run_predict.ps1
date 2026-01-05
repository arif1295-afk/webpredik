param(
  [string]$ServiceAccountPath = 'C:\path\to\service-account.json'
)

if(-not (Test-Path $ServiceAccountPath)){
  Write-Error "Service account file not found: $ServiceAccountPath"
  exit 1
}

# Load service account JSON into env var
$env:FIREBASE_SERVICE_ACCOUNT = Get-Content -Raw $ServiceAccountPath

# Change to functions folder (script is located in functions)
Set-Location $PSScriptRoot

# Run the prediction script
# Ensure Node is installed and available in PATH (recommend Node 18)
node .\scripts\predict.js
