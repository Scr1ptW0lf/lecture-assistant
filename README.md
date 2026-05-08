# Lecture Assistant

A fully local, offline-first assistant for online lectures.

- **Real-time transcription** of your lecture audio (system output, not mic)
- **Name alert** — get notified when your name is called
- **AI Q&A** grounded in your uploaded textbook (Full mode)
- **Two hardware tiers** — runs on any CPU; faster with an NVIDIA GPU

Everything runs on your machine. No cloud APIs, no data leaves your computer.

---

## Quick Start

### Windows
```powershell
git clone https://github.com/your-username/lecture-assistant
cd lecture-assistant
.\install.ps1
.venv\Scripts\python.exe main.py
```

### macOS / Linux
```bash
git clone https://github.com/your-username/lecture-assistant
cd lecture-assistant
bash install.sh
.venv/bin/python main.py
```

Then open **http://localhost:8000** in your browser.

---

## Modes

| | Lite | Full |
|---|---|---|
| Live transcription | ✓ | ✓ |
| Name-called notification | ✓ | ✓ |
| Textbook PDF upload | ✗ | ✓ |
| AI question answering | ✗ | ✓ |
| RAM needed | ~1 GB | ~6 GB |
| GPU needed | No | No (but faster with one) |

The install script asks which mode to set up.

---

## How to Use

1. **Enter your name** in the top bar (used for name detection)
2. **Select audio device** — choose the loopback/monitor device that captures your lecture audio
3. **Upload your textbook** (Full mode) — drag & drop a PDF before the lecture
4. **Click "Start listening"** — transcription begins
5. **Allow browser notifications** when prompted — you'll get an alert when your name is spoken
6. **Ask questions** in the Q&A panel (Full mode) — answers use both your textbook and the AI's general knowledge

---

## Requirements

- Python 3.10 or later
- Node.js 18 or later
- **Windows**: nothing extra — system audio is captured automatically
- **macOS**: install [BlackHole](https://existential.audio/blackhole/) virtual audio device
- **Linux**: PulseAudio or PipeWire (comes with most distros)
- **Full mode only**: [Ollama](https://ollama.com) (installed automatically on macOS/Linux)

---

## Configuration

Settings are stored in `.env` (created by the install script). Key options:

| Variable | Default | Description |
|---|---|---|
| `MODE` | `full` | `lite` or `full` |
| `WHISPER_MODEL` | `base` | `tiny`, `base`, `small` |
| `WHISPER_DEVICE` | `cpu` | `cpu` or `cuda` |
| `AUDIO_DEVICE_INDEX` | `-1` | `-1` = auto-detect, or pick from UI |
| `OLLAMA_MODEL` | `llama3.2:3b` | Any model pulled via `ollama pull` |
| `CHROMA_PATH` | system default | Where the textbook embeddings are stored |

---

## Architecture

```
System audio → faster-whisper → WebSocket → React UI
                                          → name detection → browser notification

PDF upload → PyMuPDF → ChromaDB (embeddings)
Question → ChromaDB retrieval → Ollama (llama3.2:3b) → streaming answer
```

**Stack**: FastAPI · faster-whisper · Ollama · ChromaDB · sentence-transformers · PyMuPDF · React · Vite

---

## Troubleshooting

**No transcript appears**
- Check the audio device selector — make sure a loopback/monitor device is selected
- Windows: ensure the lecture audio is playing through the default output device
- macOS: set BlackHole as your audio output (you may need a multi-output device to hear audio too)

**"No WASAPI loopback device found" on Windows**
- Open Device Manager and ensure your audio driver supports WASAPI
- Run `python -c "import pyaudiowpatch as p; a=p.PyAudio(); print([a.get_device_info_by_index(i) for i in range(a.get_device_count())]); a.terminate()"` to list devices

**Ollama not responding**
- Make sure Ollama is running: open a terminal and run `ollama serve`
- Pull the model if needed: `ollama pull llama3.2:3b`

**CUDA not detected**
- Verify PyTorch sees your GPU: `python -c "import torch; print(torch.cuda.is_available())"`
- Re-run `install.ps1` — it will reinstall with CUDA support

---

## Contributing

Pull requests welcome. See [INSTALL.md](INSTALL.md) for the full developer setup guide.

---

## License

MIT
