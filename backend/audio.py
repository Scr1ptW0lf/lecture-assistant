"""
Cross-platform system audio loopback capture.

Windows  — pyaudiowpatch WASAPI loopback (no extra software needed)
macOS    — sounddevice with BlackHole virtual device (user must install BlackHole)
Linux    — sounddevice with PulseAudio/PipeWire *.monitor source
"""
import platform
import queue
from typing import Callable

import numpy as np

_OS = platform.system()


def list_loopback_devices() -> list[dict]:
    """Return a list of available loopback/output-monitor audio devices."""
    devices = []

    if _OS == "Windows":
        try:
            import pyaudiowpatch as pyaudio  # type: ignore

            p = pyaudio.PyAudio()
            wasapi_info = p.get_host_api_info_by_type(pyaudio.paWASAPI)
            default_speakers_idx = wasapi_info["defaultOutputDevice"]
            default_speakers = p.get_device_info_by_index(default_speakers_idx)

            default_name = default_speakers["name"]
            for i in range(p.get_device_count()):
                info = p.get_device_info_by_index(i)
                if info.get("isLoopbackDevice"):
                    name = info["name"]
                    devices.append(
                        {
                            "index": i,
                            "name": name,
                            "is_recommended": (
                                name == default_name
                                or default_name in name
                                or name in default_name
                            ),
                        }
                    )
            # If nothing matched, mark the first loopback as recommended
            if devices and not any(d["is_recommended"] for d in devices):
                devices[0]["is_recommended"] = True
            p.terminate()
        except Exception:
            pass

    else:
        try:
            import sounddevice as sd  # type: ignore

            for i, dev in enumerate(sd.query_devices()):
                name = dev["name"]
                is_monitor = ".monitor" in name.lower() or "blackhole" in name.lower()
                if is_monitor or dev["max_input_channels"] > 0:
                    devices.append(
                        {
                            "index": i,
                            "name": name,
                            "is_recommended": is_monitor,
                        }
                    )
        except Exception:
            pass

    return devices


def get_loopback_stream(
    sample_rate: int,
    raw_queue: "queue.Queue[np.ndarray]",
    device_index: int = -1,
):
    """
    Return a started audio stream that pushes float32 PCM frames into raw_queue.
    The returned object has a .stop() method.
    """
    if _OS == "Windows":
        return _WasapiLoopbackStream(sample_rate, raw_queue, device_index)
    else:
        return _SounddeviceLoopbackStream(sample_rate, raw_queue, device_index)


class _WasapiLoopbackStream:
    def __init__(self, sample_rate: int, raw_queue: "queue.Queue", device_index: int):
        import pyaudiowpatch as pyaudio  # type: ignore

        self._pa = pyaudio.PyAudio()
        self._queue = raw_queue
        self._sample_rate = sample_rate

        if device_index < 0:
            # Auto-detect: find loopback device matching the default output
            wasapi_info = self._pa.get_host_api_info_by_type(pyaudio.paWASAPI)
            default_idx = wasapi_info["defaultOutputDevice"]
            default_info = self._pa.get_device_info_by_index(default_idx)
            default_name = default_info["name"]

            loopbacks = [
                (i, self._pa.get_device_info_by_index(i))
                for i in range(self._pa.get_device_count())
                if self._pa.get_device_info_by_index(i).get("isLoopbackDevice")
            ]

            if not loopbacks:
                raise RuntimeError(
                    "No WASAPI loopback device found. "
                    "Use /api/devices to list devices and set AUDIO_DEVICE_INDEX in .env"
                )

            # Exact match → prefix/substring match → first available
            device_index = next(
                (i for i, info in loopbacks if info["name"] == default_name), None
            )
            if device_index is None:
                device_index = next(
                    (i for i, info in loopbacks
                     if default_name in info["name"] or info["name"] in default_name),
                    None,
                )
            if device_index is None:
                device_index = loopbacks[0][0]

        dev_info = self._pa.get_device_info_by_index(device_index)
        native_rate = int(dev_info["defaultSampleRate"])
        channels = dev_info["maxInputChannels"] or 2

        self._native_rate = native_rate
        self._channels = channels

        self._stream = self._pa.open(
            format=pyaudio.paFloat32,
            channels=channels,
            rate=native_rate,
            input=True,
            input_device_index=device_index,
            frames_per_buffer=int(native_rate * 0.1),
            stream_callback=self._callback,
        )
        self._stream.start_stream()

    def _callback(self, in_data, frame_count, time_info, status):
        import pyaudiowpatch as pyaudio  # type: ignore

        audio = np.frombuffer(in_data, dtype=np.float32).copy()
        # Mix to mono
        audio = audio.reshape(-1, self._channels).mean(axis=1)
        # Resample to 16000 if needed
        if self._native_rate != self._sample_rate:
            audio = _resample(audio, self._native_rate, self._sample_rate)
        self._queue.put(audio)
        return (None, pyaudio.paContinue)

    def stop(self):
        self._stream.stop_stream()
        self._stream.close()
        self._pa.terminate()


class _SounddeviceLoopbackStream:
    def __init__(self, sample_rate: int, raw_queue: "queue.Queue", device_index: int):
        import sounddevice as sd  # type: ignore

        self._queue = raw_queue

        if device_index < 0:
            # Auto-detect: prefer .monitor (Linux) or BlackHole (macOS)
            for i, dev in enumerate(sd.query_devices()):
                name = dev["name"].lower()
                if ".monitor" in name or "blackhole" in name:
                    device_index = i
                    break
            if device_index < 0:
                raise RuntimeError(
                    "No loopback device found. "
                    "macOS: install BlackHole (https://existential.audio/blackhole/). "
                    "Linux: select a *.monitor device via the UI device picker."
                )

        self._stream = sd.InputStream(
            device=device_index,
            samplerate=sample_rate,
            channels=1,
            dtype="float32",
            blocksize=int(sample_rate * 0.1),
            callback=self._callback,
        )
        self._stream.start()

    def _callback(self, indata, frames, time, status):
        self._queue.put(indata[:, 0].copy())

    def stop(self):
        self._stream.stop()
        self._stream.close()


def _resample(audio: np.ndarray, from_rate: int, to_rate: int) -> np.ndarray:
    """Simple linear resample (good enough for speech; avoids scipy dependency)."""
    if from_rate == to_rate:
        return audio
    target_len = int(len(audio) * to_rate / from_rate)
    indices = np.linspace(0, len(audio) - 1, target_len)
    return np.interp(indices, np.arange(len(audio)), audio).astype(np.float32)
