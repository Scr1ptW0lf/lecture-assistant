#!/usr/bin/env bash
# Lecture Assistant — macOS / Linux installer
set -euo pipefail

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS="$(uname -s)"

echo ""
echo "=== Lecture Assistant Installer ($OS) ==="
echo ""

# ── Python check ──────────────────────────────────────────────────────────────
PYTHON=""
for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
        ver=$("$cmd" --version 2>&1 | grep -oP '\d+\.\d+' | head -1)
        maj=$(echo "$ver" | cut -d. -f1)
        min=$(echo "$ver" | cut -d. -f2)
        if [ "$maj" -ge 3 ] && [ "$min" -ge 10 ]; then
            PYTHON="$cmd"; break
        fi
    fi
done
if [ -z "$PYTHON" ]; then
    echo "ERROR: Python 3.10+ not found."
    if [ "$OS" = "Darwin" ]; then echo "Install with: brew install python@3.12"; fi
    exit 1
fi
echo "Python: $PYTHON ($($PYTHON --version))"

# ── Node check ────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js not found. Visit https://nodejs.org"
    exit 1
fi
echo "Node: $(node --version)"

# ── GPU detection ─────────────────────────────────────────────────────────────
HAS_CUDA=false; HAS_ROCM=false
if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
    HAS_CUDA=true
    echo "GPU (CUDA): $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
elif command -v rocm-smi &>/dev/null && rocm-smi &>/dev/null; then
    HAS_ROCM=true
    echo "GPU (ROCm) detected"
else
    echo "No GPU detected — CPU mode will be used."
fi

# ── macOS: BlackHole check ────────────────────────────────────────────────────
if [ "$OS" = "Darwin" ]; then
    if ! system_profiler SPAudioDataType 2>/dev/null | grep -qi "blackhole"; then
        echo ""
        echo "⚠  BlackHole virtual audio device not found."
        echo "   Lecture Assistant captures system audio via BlackHole on macOS."
        echo "   Install it from: https://existential.audio/blackhole/"
        echo "   After installing, set BlackHole as your audio output, then re-run this script."
        echo ""
        read -rp "Press Enter to continue anyway (you can install BlackHole later)..."
    else
        echo "BlackHole detected ✓"
    fi
fi

# ── Linux: PulseAudio/PipeWire note ──────────────────────────────────────────
if [ "$OS" = "Linux" ]; then
    echo "Linux: System audio will be captured via PulseAudio/PipeWire monitor source."
    echo "       Select the correct .monitor device in the app's device picker."
fi

# ── Mode selection ────────────────────────────────────────────────────────────
echo ""
echo "Select mode:"
echo "  [1] Full  — transcription + name alerts + AI Q&A (~6 GB RAM)"
echo "  [2] Lite  — transcription + name alerts only    (~1 GB RAM)"
echo ""
read -rp "Enter 1 or 2 [default: 1]: " mode_choice
MODE="full"
[ "$mode_choice" = "2" ] && MODE="lite"
echo "Mode: $MODE"

# ── Virtual environment ───────────────────────────────────────────────────────
echo ""
echo "Creating Python virtual environment..."
"$PYTHON" -m venv "$BASE/.venv"
PIP="$BASE/.venv/bin/pip"
PYTHON_VENV="$BASE/.venv/bin/python"
"$PIP" install --upgrade pip --quiet

# ── PyTorch ───────────────────────────────────────────────────────────────────
DEVICE="cpu"; COMPUTE="int8"; WHISPER_MODEL="tiny"
if [ "$MODE" = "full" ]; then
    WHISPER_MODEL="base"
    if $HAS_CUDA; then
        echo "Installing PyTorch (CUDA 12.1)..."
        "$PIP" install torch --index-url https://download.pytorch.org/whl/cu121 --quiet
        DEVICE="cuda"; COMPUTE="float16"
    elif $HAS_ROCM; then
        echo "Installing PyTorch (ROCm)..."
        "$PIP" install torch --index-url https://download.pytorch.org/whl/rocm6.0 --quiet
        DEVICE="cuda"; COMPUTE="float16"
    else
        echo "Installing PyTorch (CPU)..."
        "$PIP" install torch --index-url https://download.pytorch.org/whl/cpu --quiet
    fi
    echo "Installing Full mode dependencies..."
    "$PIP" install -r "$BASE/requirements-full.txt" --quiet
else
    echo "Installing Lite mode dependencies..."
    "$PIP" install -r "$BASE/requirements-lite.txt" --quiet
fi

# ── Ollama (full mode only) ───────────────────────────────────────────────────
if [ "$MODE" = "full" ]; then
    if ! command -v ollama &>/dev/null; then
        echo "Ollama not found. Installing..."
        curl -fsSL https://ollama.com/install.sh | sh
    fi
    echo "Pulling llama3.2:3b (~2 GB)..."
    ollama pull llama3.2:3b
fi

# ── Frontend ──────────────────────────────────────────────────────────────────
echo ""
echo "Installing and building frontend..."
cd "$BASE/frontend"
npm install --silent
npm run build
cd "$BASE"

# ── Write .env ────────────────────────────────────────────────────────────────
CHROMA_PATH="$HOME/.local/share/lecture-assistant/chroma_db"
cat > "$BASE/.env" <<EOF
MODE=$MODE
WHISPER_MODEL=$WHISPER_MODEL
WHISPER_DEVICE=$DEVICE
WHISPER_COMPUTE_TYPE=$COMPUTE
AUDIO_DEVICE_INDEX=-1
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
CHROMA_PATH=$CHROMA_PATH
EOF

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "==================================================="
echo " Installation complete!"
echo ""
echo " To start Lecture Assistant:"
echo "   $BASE/.venv/bin/python main.py"
echo ""
echo " Then open: http://localhost:8000"
echo "==================================================="
