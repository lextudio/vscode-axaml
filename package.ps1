Param(
    [string]$OutDir = "$(Join-Path $PSScriptRoot 'output')"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ExtDir = Join-Path $RootDir 'src\vscode-axaml'

Write-Host "Packaging VS Code Tools for AXAML extension"
Write-Host "Root: $RootDir"
Write-Host "Extension: $ExtDir"
Write-Host "Output: $OutDir"

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

Push-Location $ExtDir

# Ensure README / LICENSE from repo root are used for packaging
Remove-Item -Force -ErrorAction SilentlyContinue README.md, LICENSE
Copy-Item -Path (Join-Path $RootDir 'README.md') -Destination README.md -Force
Copy-Item -Path (Join-Path $RootDir 'LICENSE') -Destination LICENSE -Force

Write-Host "Building & bundling extension (TypeScript via esbuild)..."
npm install
npm run bundle

Write-Host "Packaging with vsce..."
if (Get-Command vsce -ErrorAction SilentlyContinue) {
    vsce package -o $OutDir
} else {
    Write-Error "vsce not found. Install with: npm install -g @vscode/vsce"
    Pop-Location
    exit 1
}

Remove-Item -Force -ErrorAction SilentlyContinue README.md, LICENSE

Pop-Location

Write-Host "Package(s) written to $OutDir"
