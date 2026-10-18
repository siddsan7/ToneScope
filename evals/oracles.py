"""Independent specification math and deterministic fixtures; standard library only."""
import hashlib
import math
import random
import struct
from pathlib import Path

VERSION = "independent_math_v1"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def rms(values):
    values = list(values)
    return math.sqrt(math.fsum(x * x for x in values) / len(values)) if values else 0.0


def db(value):
    return 20 * math.log10(value) if value > 0 else None


def residual(a, b):
    if len(a) != len(b):
        raise ValueError("sample count mismatch")
    errors = [x - y for x, y in zip(a, b)]
    return {"max_abs": max(map(abs, errors), default=0.0), "rms": rms(errors)}


def compressor_gain_db(level_db, threshold_db, ratio, knee_db=0):
    """Static hard/soft-knee transfer curve, independent of engine coefficients."""
    delta = level_db - threshold_db
    if knee_db and -knee_db / 2 < delta < knee_db / 2:
        return (1 / ratio - 1) * (delta + knee_db / 2) ** 2 / (2 * knee_db)
    return (1 / ratio - 1) * delta if delta >= knee_db / 2 else 0.0


def fixture(kind, frames=8192, channels=2, sample_rate=48000):
    rng = random.Random(271828)
    result = [[] for _ in range(channels)]
    for i in range(frames):
        for c in range(channels):
            if kind == "silence":
                value = 0.0
            elif kind == "impulse":
                value = 0.75 if i == c * 13 else 0.0
            elif kind == "noise":
                value = rng.uniform(-0.45, 0.45)
            elif kind == "dc":
                value = 0.5
            elif kind == "multitone":
                value = sum(0.08 * math.sin(2 * math.pi * f * i / sample_rate + c * .3)
                            for f in (113, 997, 7001))
            else:
                raise ValueError(kind)
            result[c].append(value)
    return result


def write_float_wav(path, samples, sample_rate=48000):
    channels = len(samples)
    if not channels or len({len(c) for c in samples}) != 1:
        raise ValueError("invalid channel shape")
    payload = b"".join(struct.pack("<f", value) for frame in zip(*samples) for value in frame)
    fmt = struct.pack("<HHIIHH", 3, channels, sample_rate, sample_rate * channels * 4, channels * 4, 32)
    data = b"WAVEfmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(payload)) + payload
    Path(path).write_bytes(b"RIFF" + struct.pack("<I", len(data)) + data)


def read_wav(path):
    """Read RIFF PCM/float samples without using the product decoder."""
    data = Path(path).read_bytes()
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("invalid RIFF/WAVE")
    offset, fmt, payload = 12, None, None
    while offset + 8 <= len(data):
        kind, size = struct.unpack_from("<4sI", data, offset)
        offset += 8
        if offset + size > len(data):
            raise ValueError("truncated chunk")
        chunk = data[offset:offset + size]
        if kind == b"fmt ":
            fmt = struct.unpack_from("<HHIIHH", chunk)
        elif kind == b"data":
            payload = chunk
        offset += size + (size & 1)
    if fmt is None or payload is None:
        raise ValueError("missing format or data")
    code, channels, rate, _, align, bits = fmt
    width = bits // 8
    if channels < 1 or align != channels * width or len(payload) % align:
        raise ValueError("invalid frame layout")
    result = [[] for _ in range(channels)]
    for pos in range(0, len(payload), width):
        raw = payload[pos:pos + width]
        if code == 3 and bits in (32, 64):
            value = struct.unpack("<f" if bits == 32 else "<d", raw)[0]
        elif code == 1 and bits in (8, 16, 24, 32):
            value = ((raw[0] - 128) / 128 if bits == 8 else
                     int.from_bytes(raw, "little", signed=True) / (2 ** (bits - 1)))
        else:
            raise ValueError("unsupported format")
        if not math.isfinite(value):
            raise ValueError("nonfinite audio")
        result[(pos // width) % channels].append(value)
    return rate, result


def flatten(channels):
    return [value for frame in zip(*channels) for value in frame]
