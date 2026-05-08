# Detailed Installation Guide

## Windows (Recommended — developed here first)

### Prerequisites

| Software | Minimum version | Download |
|---|---|---|
| Python | 3.10 | https://python.org |
| Node.js | 18 | https://nodejs.org |
| Ollama (Full mode) | latest | https://ollama.com/download/windows |
| NVIDIA driver (GPU users) | 520+ | NVIDIA website |

### One-command install

```powershell
.\install.ps1
```

The script will:
1. Detect your GPU
2. Ask Lite or Full mode
3. Install Python dependencies (with CUDA PyTorch if GPU found)
4. Pull the `llama3.2:3b` Ollama model (Full only)
5. Build the React frontend
6. Write a `.env` config file

### Manual install (developers)

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1

# GPU users only — install CUDA PyTorch first:
pip install torch --index-url https://download.pytorch.org/whl/cu121

# Full mode:
pip install -r requirements-full.txt
# Lite mode:
pip install -r requirements-lite.txt

# Build frontend:
cd frontend
npm install
npm run build
cd ..

# Copy and edit config:
copy .env.example .env
# Edit .env to set MODE, WHISPER_DEVICE, etc.

# Run:
.venv\Scripts\python.exe main.py
```

### Audio setup (Windows)

No extra software needed. `pyaudiowpatch` captures the WASAPI loopback device automatically. If auto-detection fails, use the device picker in the UI.

---

## macOS

### Prerequisites

```bash
brew install python@3.12 node
```

### BlackHole (required for system audio capture)

1. Download from https://existential.audio/blackhole/
2. Install the **2ch** version
3. Open **Audio MIDI Setup** → create a **Multi-Output Device** with your speakers + BlackHole
4. Set the Multi-Output Device as your system audio output
5. In Lecture Assistant, select **BlackHole** as the audio device

This lets you hear audio AND capture it simultaneously.

### Install

```bash
bash install.sh
.venv/bin/python main.py
```

---

## Linux

### Prerequisites

```bash
# Debian/Ubuntu:
sudo apt install python3.12 python3.12-venv nodejs npm

# Arch:
sudo pacman -S python nodejs npm
```

### Audio setup

PulseAudio and PipeWire both expose `.monitor` sources that capture system audio output. In Lecture Assistant, select the `*.monitor` device matching your output device (e.g., `alsa_output.pci-0000_00_1f.3.analog-stereo.monitor`).

### Install

```bash
bash install.sh
.venv/bin/python main.py
```

---

## Developer setup

```bash
# Install dev extras (linting + tests):
pip install -r requirements-dev.txt

# Run backend with hot reload:
uvicorn main:app --reload

# Run frontend dev server (proxies /api and /ws to :8000):
cd frontend && npm run dev
# Open http://localhost:5173

# Lint:
ruff check .

# Tests:
pytest
```

---

## Changing mode after install

Re-run the install script and choose a different mode, or edit `.env` manually:

```
MODE=lite   # or full
```

Then restart `main.py`.
