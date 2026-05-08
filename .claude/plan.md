# Lecture Assistant — Roadmap / Plan

## Current state (v0.1 — complete)

- [x] Real-time system audio loopback transcription (faster-whisper, CUDA)
- [x] Name detection with exact + fuzzy matching (difflib)
- [x] Browser notification on name detection
- [x] PDF upload and ingestion (PyMuPDF → ChromaDB)
- [x] Semantic RAG Q&A with streaming (Ollama llama3.2:3b + sentence-transformers)
- [x] Two hardware modes: Lite (CPU, transcription only) and Full (GPU + LLM)
- [x] React + Vite frontend (WebSocket transcript, SSE Q&A, drag-drop PDF upload)
- [x] Cross-platform audio abstraction (WASAPI / BlackHole / PulseAudio)
- [x] Windows installer (`install.ps1`) + macOS/Linux installer (`install.sh`)
- [x] CLAUDE.md, README.md, INSTALL.md, LICENSE

---

## Near-term (v0.2)

### Testing the running app
- [ ] Verify CUDA: `.venv\Scripts\python.exe -c "import torch; print(torch.cuda.is_available())"`
- [ ] Verify Whisper loads on CUDA: start `main.py`, check startup logs
- [ ] Verify WASAPI loopback device is auto-detected on Windows
- [ ] Verify browser notification fires on name detection
- [ ] Verify PDF ingest → Q&A round-trip works

### Bug fixes likely after first run
- [ ] Audio resampling: if WASAPI native rate ≠ 16000 Hz, `_resample()` in `audio.py` handles it — test that it works correctly
- [ ] `WhisperEngine.stop()` / `start()` race: ensure reconnect on WS disconnect doesn't double-start
- [ ] ChromaDB path: confirm `%LOCALAPPDATA%\lecture-assistant\chroma_db` is created automatically

### UX improvements
- [ ] Audio level meter in UI (so user can confirm loopback is working before lecture)
- [ ] Show currently ingested PDFs list with delete option
- [ ] Transcript export to `.txt` / `.md` file
- [ ] Auto-scroll toggle button (currently auto-pauses on manual scroll — add explicit button)

---

## Medium-term (v0.3)

### Reliability
- [ ] `TranscriptionEngine` restart guard — currently `engine` is a module singleton; if server reloads (`--reload`), model reloads too. Consider lazy load with a global flag.
- [ ] Handle Ollama not running gracefully — return `503` with clear message instead of httpx timeout
- [ ] Validate that `pyaudiowpatch` finds a loopback device on startup; surface error in UI if not

### Features
- [ ] **Lecture summary** — at end of session, send full transcript to Ollama and generate a bullet-point summary
- [ ] **Question detection** — highlight lines in the transcript where a question was asked (ends with `?`)
- [ ] **Multiple PDF support** — ingest multiple textbooks; show which source each RAG chunk came from
- [ ] **Timestamp search** — click a Q&A answer to jump to the transcript line where the topic was mentioned
- [ ] **Hotkey** — keyboard shortcut to quickly type a question without switching focus to the browser

### Model options
- [ ] Add `OLLAMA_MODEL` selector in the UI (dropdown populated from `ollama list`)
- [ ] Support `mistral:7b` and `llama3.1:8b` as alternative models
- [ ] Whisper model selector in UI (tiny / base / small) with live reload

---

## Long-term (v1.0 — release-ready)

### Packaging / distribution
- [ ] **Single-file launcher** — `launcher.py` that checks deps, starts `ollama serve` if needed, then starts `main.py`; double-click to run
- [ ] **Windows `.exe`** — PyInstaller bundle so non-technical users don't need Python installed
- [ ] **macOS `.app`** — py2app or PyInstaller bundle
- [ ] **Auto-update** — check GitHub releases on startup and prompt to update

### macOS / Linux parity
- [ ] Test full stack on macOS (BlackHole multi-output device setup)
- [ ] Test full stack on Ubuntu 24.04 (PipeWire monitor source)
- [ ] Linux: auto-detect and select the correct `.monitor` device without user action
- [ ] macOS: detect when BlackHole is not set as output and show setup instructions in UI

### Accessibility / UX polish
- [ ] Dark/light mode toggle
- [ ] Font size control
- [ ] Mobile-responsive layout (for tablet use during lecture)
- [ ] Keyboard-navigable Q&A history

### Security / privacy
- [ ] All data stays local — add explicit privacy statement to README
- [ ] Option to disable transcript logging entirely (name detection only, no stored text)
- [ ] Encrypted ChromaDB store option

---

## Known limitations / technical debt

| Item | Notes |
|------|-------|
| 2.5 s transcript latency | Inherent to chunk-based Whisper; reduce `AUDIO_CHUNK_SECONDS` to `1.5` for faster (but more fragmented) output |
| No speaker diarization | All speech treated as one speaker — can't distinguish professor vs student |
| English-only transcription | `language="en"` hardcoded in `transcription.py` — add language selector for non-English lectures |
| ChromaDB not thread-safe for concurrent writes | Single-user app, so fine; would need a queue if multi-user ever considered |
| PyTorch 2.5.1+cu121 on Python 3.12 | Locked to Python 3.12 (3.14 has no PyTorch wheels yet); revisit when PyTorch supports 3.14 |
| `install.ps1` uses `Read-Host` | Blocked by antivirus in encoded PS sessions; user must run directly in their own terminal |

---

## Architecture decisions log

| Decision | Why |
|----------|-----|
| System audio loopback (not mic) | Lectures are online; mic would capture room noise not lecture audio |
| Two hardware tiers | Wide range of student hardware; Lite ensures everyone can use core feature |
| Ollama (not llama-cpp-python directly) | Simpler cross-platform model management; user can swap models without code changes |
| ChromaDB path in `%LOCALAPPDATA%` on Windows | Avoids OneDrive sync locking the SQLite WAL file |
| Python 3.12 venv despite system Python 3.14 | PyTorch wheel availability; 3.12 is LTS-equivalent for ML libs |
| `npm.cmd` instead of `npm` in PowerShell | Windows PS execution policy blocks `.ps1` wrapper scripts |
| `upsert` not `add` in ChromaDB | Re-uploading same PDF is safe; deterministic IDs by filename + chunk index |
