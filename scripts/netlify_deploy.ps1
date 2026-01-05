<#
PowerShell helper to create or link a Netlify site and deploy the current repo.

Prerequisites:
- Install Netlify CLI: `npm install -g netlify-cli`
- Login: `netlify login`

Usage:
  From project root:
    .\scripts\netlify_deploy.ps1 -SiteName webpredik -RepoUrl https://github.com/arif1295-afk/webpredik

This script will attempt to create a new Netlify site bound to the GitHub repo
and perform an initial deploy. If a site with the same name exists, it will link.
#>

param(
  [string]$SiteName = "",
  [string]$RepoUrl = "",
  [switch]$Prod
)

if(-not (Get-Command netlify -ErrorAction SilentlyContinue)){
  Write-Error "Netlify CLI not found. Install it with: npm install -g netlify-cli"
  exit 1
}

Write-Host "Logging into Netlify (interactive browser may open)..."
netlify status 2>$null | Out-Null
if($LASTEXITCODE -ne 0){ netlify login }

if($SiteName){
  Write-Host "Creating or linking site: $SiteName"
  # Try to create site; if fails, attempt to link by name
  $createArgs = @('sites:create')
  if($Prod.IsPresent){ $createArgs += '--prod' }
  $createArgs += '--name'; $createArgs += $SiteName
  try{
    netlify @createArgs
  }catch{
    Write-Host "Create failed, attempting to link existing site by name..."
    try{ netlify sites:list | Select-String $SiteName }catch{}
  }
}

if($RepoUrl){
  Write-Host "Linking repository: $RepoUrl"
  # Use netlify init to connect to repo when possible
  netlify init --manual --dir=. 2>$null | Out-Null
  # Netlify CLI cannot fully automate GitHub App install; instruct user if needed
  Write-Host "If prompted, follow the Netlify dashboard steps to connect GitHub repository to enable continuous deploys."
}

Write-Host "Running initial deploy..."
if($Prod.IsPresent){ netlify deploy --prod --dir=. } else { netlify deploy --dir=. }

Write-Host "Done. Check Netlify dashboard for site settings and continuous deploy configuration."
