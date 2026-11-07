# Hearth - builds the Windows installer (Hearth_x.y.z_x64-setup.exe)
# First run: installs Node.js, Rust and the MSVC C++ Build Tools with winget,
# then compiles everything (~15-30 min).
# Next runs: tools are skipped, npm packages are reused when nothing changed,
# and Rust reuses a shared build cache in %LOCALAPPDATA%\HearthBuild, even when
# the new version is unzipped into a different folder (~1-3 min).

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:USERPROFILE\.cargo\bin"
}
function Step($text) { Write-Host "`n==> $text" -ForegroundColor DarkYellow }
$started = Get-Date

if (-not (Has winget)) { throw "winget est introuvable. Installe 'App Installer' depuis le Microsoft Store." }
$wingetArgs = @('--exact', '--accept-source-agreements', '--accept-package-agreements', '--silent')

Step "Outils"
if (-not (Has node)) { Write-Host "Installation de Node.js..."; winget install --id OpenJS.NodeJS.LTS @wingetArgs; Refresh-Path }
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVC = (Test-Path $vswhere) -and [bool](& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if (-not $hasVC) {
    Write-Host "Installation des Build Tools C++ (Windows va demander l'autorisation administrateur)..."
    winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --accept-source-agreements --accept-package-agreements `
        --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
}
if (-not (Has cargo)) { Write-Host "Installation de Rust..."; winget install --id Rustlang.Rustup @wingetArgs; Refresh-Path; rustup default stable | Out-Null }
Write-Host "Node $(node --version) | $(cargo --version)"

# One shared Rust cache for every Hearth version: only Hearth itself recompiles.
$cache = Join-Path $env:LOCALAPPDATA 'HearthBuild'
$env:CARGO_TARGET_DIR = Join-Path $cache 'target'
New-Item -ItemType Directory -Force -Path $cache | Out-Null

Step "Dependances npm"
$lockHash = (Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash
$stamp = 'node_modules\.hearth-lock'
$sharedModules = Join-Path $cache 'node_modules'
$sharedStamp = Join-Path $sharedModules '.hearth-lock'
if ((Test-Path $stamp) -and ((Get-Content $stamp) -eq $lockHash)) {
    Write-Host "Deja a jour, rien a telecharger."
} elseif ((Test-Path $sharedStamp) -and ((Get-Content $sharedStamp) -eq $lockHash)) {
    Write-Host "Reutilisation des paquets de la version precedente..."
    if (Test-Path 'node_modules') { Remove-Item 'node_modules' -Recurse -Force }
    robocopy $sharedModules 'node_modules' /E /NFL /NDL /NJH /NJS /NP | Out-Null
} else {
    npm ci --no-audit --no-fund --prefer-offline
    Set-Content $stamp $lockHash
    if (Test-Path $sharedModules) { Remove-Item $sharedModules -Recurse -Force }
    robocopy 'node_modules' $sharedModules /E /NFL /NDL /NJH /NJS /NP | Out-Null
}

Step "Compilation de Hearth"
npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "La compilation a echoue (voir les messages plus haut)." }

$exe = Get-ChildItem (Join-Path $env:CARGO_TARGET_DIR 'release\bundle\nsis\*.exe') | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $exe) { throw "L'installateur n'a pas ete trouve dans $env:CARGO_TARGET_DIR\release\bundle\nsis." }
$dest = Join-Path $PSScriptRoot $exe.Name
Copy-Item $exe.FullName $dest -Force
$minutes = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
Write-Host "`nInstallateur pret en $minutes min : $dest" -ForegroundColor Green
Start-Process explorer.exe "/select,`"$dest`""
