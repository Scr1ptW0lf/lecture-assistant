#Requires -Version 5.1
<#
.SYNOPSIS
    Lecture Assistant — Windows installer
.DESCRIPTION
    Sets up a Python virtual environment, installs dependencies for the
    selected mode (lite or full), optionally pulls the Ollama model,
    and builds the React frontend.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$BASE = $PSScriptRoot

Write-Host ""
Write-Host "=== Lecture Assistant Installer (Windows) ===" -ForegroundColor Cyan
Write-Host ""

# ── Python check ──────────────────────────────────────────────────────────────
$python = $null
foreach ($cmd in @("python", "python3")) {
    try {
        $ver = & $cmd --version 2>&1
        if ($ver -match "Python (\d+)\.(\d+)") {
            $maj = [int]$Matches[1]; $min = [int]$Matches[2]
            if ($maj -ge 3 -and $min -ge 10) { $python = $cmd; break }
        }
    } catch { }
}
if (-not $python) {
    Write-Host "ERROR: Python 3.10+ not found. Download from https://python.org" -ForegroundColor Red
    exit 1
}
Write-Host "Python found: $python" -ForegroundColor Green

# ── Node check ────────────────────────────────────────────────────────────────
try {
    $nodeVer = & node --version 2>&1
    Write-Host "Node found: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js not found. Download from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# ── GPU detection ─────────────────────────────────────────────────────────────
$hasGpu = $false
try {
    $smi = & nvidia-smi --query-gpu=name --format=csv,noheader 2>&1
    if ($LASTEXITCODE -eq 0 -and $smi) { $hasGpu = $true; Write-Host "GPU: $($smi.Trim())" -ForegroundColor Green }
} catch { }
if (-not $hasGpu) { Write-Host "No NVIDIA GPU detected — will use CPU mode." -ForegroundColor Yellow }

# ── Mode selection ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Select mode:"
Write-Host "  [1] Full  — transcription + name alerts + AI Q&A (requires ~6 GB RAM)"
Write-Host "  [2] Lite  — transcription + name alerts only   (requires ~1 GB RAM)"
Write-Host ""
$modeChoice = Read-Host "Enter 1 or 2 [default: 1]"
$mode = if ($modeChoice -eq "2") { "lite" } else { "full" }
Write-Host "Mode: $mode" -ForegroundColor Cyan

# ── Virtual environment ───────────────────────────────────────────────────────
Write-Host ""
Write-Host "Creating Python virtual environment..." -ForegroundColor Cyan
& $python -m venv "$BASE\.venv"
$pip = "$BASE\.venv\Scripts\pip.exe"
$pythonVenv = "$BASE\.venv\Scripts\python.exe"

# Upgrade pip silently
& $pip install --upgrade pip --quiet

# ── PyTorch (CUDA or CPU) ─────────────────────────────────────────────────────
if ($mode -eq "full") {
    if ($hasGpu) {
        Write-Host "Installing PyTorch with CUDA 12.1..." -ForegroundColor Cyan
        & $pip install torch --index-url https://download.pytorch.org/whl/cu121 --quiet
        $device = "cuda"
        $computeType = "float16"
    } else {
        Write-Host "Installing PyTorch (CPU)..." -ForegroundColor Cyan
        & $pip install torch --index-url https://download.pytorch.org/whl/cpu --quiet
        $device = "cpu"
        $computeType = "int8"
    }
    Write-Host "Installing Full mode dependencies..." -ForegroundColor Cyan
    & $pip install -r "$BASE\requirements-full.txt" --quiet
    $whisperModel = "base"
} else {
    Write-Host "Installing Lite mode dependencies..." -ForegroundColor Cyan
    & $pip install -r "$BASE\requirements-lite.txt" --quiet
    $device = "cpu"
    $computeType = "int8"
    $whisperModel = "tiny"
}

# ── Ollama (full mode only) ───────────────────────────────────────────────────
if ($mode -eq "full") {
    Write-Host ""
    $ollamaOk = $false
    try {
        $null = & ollama --version 2>&1
        if ($LASTEXITCODE -eq 0) { $ollamaOk = $true }
    } catch { }

    if (-not $ollamaOk) {
        Write-Host "Ollama not found. Opening download page..." -ForegroundColor Yellow
        Start-Process "https://ollama.com/download/windows"
        Write-Host "Install Ollama, then press Enter to continue..." -ForegroundColor Yellow
        Read-Host
    }

    Write-Host "Pulling llama3.2:3b model (this downloads ~2 GB)..." -ForegroundColor Cyan
    & ollama pull llama3.2:3b
}

# ── Frontend ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
Push-Location "$BASE\frontend"
& npm install --silent
Write-Host "Building frontend..." -ForegroundColor Cyan
& npm run build
Pop-Location

# ── Write .env ────────────────────────────────────────────────────────────────
$chromaPath = [System.IO.Path]::Combine($env:LOCALAPPDATA, "lecture-assistant", "chroma_db")
$env_content = @"
MODE=$mode
WHISPER_MODEL=$whisperModel
WHISPER_DEVICE=$device
WHISPER_COMPUTE_TYPE=$computeType
AUDIO_DEVICE_INDEX=-1
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
CHROMA_PATH=$($chromaPath -replace '\\', '/')
"@
Set-Content -Path "$BASE\.env" -Value $env_content -Encoding utf8

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "===================================================" -ForegroundColor Green
Write-Host " Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host " To start Lecture Assistant:" -ForegroundColor White
Write-Host "   $BASE\.venv\Scripts\python.exe main.py" -ForegroundColor Yellow
Write-Host ""
Write-Host " Then open: http://localhost:8000" -ForegroundColor White
Write-Host "===================================================" -ForegroundColor Green
