"""Independent transfer-function and detector convention references.

EQ uses bilinear transforms of analog transfer functions, rather than product
biquad state/coefficient code. Compressor convention: 10 ms energy detector,
then attack/release exponential averaging of desired gain reduction in dB.
"""
import cmath
import math
from oracles import compressor_gain_db


def eq_response(frequency, rate, low_db=0, mid_db=0, high_db=0, mid_hz=1000, mid_q=.707):
    def laplace(center):
        z = cmath.exp(-2j * math.pi * frequency / rate)
        return (1-z) / (1+z) / math.tan(math.pi * center / rate)
    def shelf(center, db, high):
        s = laplace(center)
        a = 10 ** (db / 40)
        t = math.sqrt(2*a)*s
        numerator, denominator = (a*s*s+t+1), (s*s+t+a)
        return a * (numerator / denominator if high else denominator / numerator)
    s, a = laplace(mid_hz), 10 ** (mid_db/40)
    peak = (s*s + a*s/mid_q + 1) / (s*s + s/(a*mid_q) + 1)
    return shelf(120, low_db, False) * peak * shelf(min(6000, .4*rate), high_db, True)


def tone_transfer(input_samples, output_samples, frequency, rate):
    if len(input_samples) != len(output_samples) or not input_samples:
        raise ValueError("transfer shape")
    phase = [cmath.exp(-2j*math.pi*frequency*n/rate) for n in range(len(input_samples))]
    original = sum(x*p for x,p in zip(input_samples,phase))
    if abs(original) < 1e-12:
        raise ValueError("undefined transfer")
    return sum(x*p for x,p in zip(output_samples,phase)) / original


def compressor_reference(samples, rate, threshold=-18, ratio=4, knee=6, attack_ms=10, release_ms=150):
    energy, reduction = 0., 0.
    detector_decay = math.exp(-1/(.010*rate))
    output = []
    for sample in samples:
        energy = sample*sample + detector_decay*(energy-sample*sample)
        desired = -compressor_gain_db(10*math.log10(max(energy,1e-30)),threshold,ratio,knee)
        duration = attack_ms if desired > reduction else release_ms
        reduction = desired + math.exp(-1000/(duration*rate))*(reduction-desired)
        output.append(sample*10**(-reduction/20))
    return output


def lr4_response(frequency, crossover, rate, high=False):
    z = cmath.exp(-2j*math.pi*frequency/rate)
    s = (1-z)/(1+z)/math.tan(math.pi*crossover/rate)
    butterworth = (s*s if high else 1)/(s*s+math.sqrt(2)*s+1)
    return butterworth*butterworth


def crossover_response(frequency, rate, low=200, high=2000):
    lo, hi = lr4_response(frequency, low, rate), lr4_response(frequency, low, rate, True)
    upperlo, upperhi = lr4_response(frequency, high, rate), lr4_response(frequency, high, rate, True)
    return lo*(upperlo+upperhi) + hi*upperlo + hi*upperhi


def drive_periodic_reference(frequency, rate, frames, amplitude=.5, drive_db=30, tone_hz=5000, factor=256, phase_offset=0):
    """Bandlimited periodic tanh reference by Fourier quadrature.

    No product FIR/decimator code is used. Source-rate pre-emphasis is evaluated
    analytically; only intended harmonics below source Nyquist survive ideal
    reconstruction. Tone/DC transfer is evaluated at a converging high rate.
    This reference excludes warmup and tests steady-state single-tone aliasing.
    """
    pre = 1.25-.25*cmath.exp(-2j*math.pi*frequency/rate)
    phase, level = cmath.phase(pre), amplitude*abs(pre)*10**(drive_db/20)
    count = 8192
    shaped = [math.tanh(level*math.sin(2*math.pi*n/count)) for n in range(count)]
    result = [0.]*frames
    harmonics = []
    internal = rate*factor
    tone_decay, dc_decay = math.exp(-2*math.pi*tone_hz/internal), math.exp(-2*math.pi*20/internal)
    for harmonic in range(1,int((rate/2)/frequency)+1,2):
        coefficient = 2/count*math.fsum(x*math.sin(2*math.pi*harmonic*n/count) for n,x in enumerate(shaped))
        hz = harmonic*frequency
        z = cmath.exp(-2j*math.pi*hz/internal)
        transfer = (1-tone_decay)/(1-tone_decay*z)*(1-z)/(1-dc_decay*z)
        harmonics.append({"harmonic":harmonic,"frequency_hz":hz,"amplitude":coefficient*abs(transfer)})
        for n in range(frames):
            result[n] += coefficient*abs(transfer)*math.sin(2*math.pi*hz*n/rate+harmonic*(phase+phase_offset)+cmath.phase(transfer))
    return result, harmonics
