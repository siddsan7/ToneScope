"""Analytic anchors and intentional DSP/evaluator mutations."""
import cmath
import math
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"evals"))
from numeric import eq_response, crossover_response, compressor_reference, drive_periodic_reference
from oracles import residual, rms, write_float_wav
from run import Runner


class NumericEvaluatorTests(unittest.TestCase):
    def test_eq_analytic_anchors(self):
        for rate in (44100,48000,96000):
            self.assertAlmostEqual(abs(eq_response(1000,rate,mid_db=12)),10**(12/20),places=10)
            self.assertAlmostEqual(abs(eq_response(1000,rate,mid_db=-12)),10**(-12/20),places=10)
            self.assertAlmostEqual(abs(eq_response(.00001,rate,low_db=6)),10**(6/20),places=10)
            self.assertAlmostEqual(abs(eq_response(rate/2-.00001,rate,high_db=-6)),10**(-6/20),places=10)

    def test_crossover_allpass_has_phase(self):
        for hz in (30,100,200,1000,2000,10000,18000):
            value=crossover_response(hz,48000)
            self.assertAlmostEqual(abs(value),1,places=12)
        self.assertGreater(abs(crossover_response(1000,48000)-1),.1)

    def test_compressor_ratio1_and_settled_curve(self):
        original=[.5]*48000
        self.assertEqual(compressor_reference(original,48000,ratio=1),original)
        result=compressor_reference(original,48000,knee=0)
        expected_db=-(20*math.log10(.5)+18)*.75
        self.assertAlmostEqual(20*math.log10(result[-1]/.5),expected_db,places=9)

    def test_alias_reference_convergence_and_declared_harmonics(self):
        a,harmonics=drive_periodic_reference(4000,48000,1024,factor=2048)
        b,_=drive_periodic_reference(4000,48000,1024,factor=4096)
        self.assertLess(residual(a,b)["rms"],.0001)
        self.assertEqual([x["frequency_hz"] for x in harmonics],[4000,12000,20000])
        self.assertTrue(all(math.isfinite(x) for x in b))

    def test_actual_eq_gate_kills_gain_phase_and_db_mutations(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            folder=Path(tmp)
            # Fake renderer is only used to inject deliberately faulty responses
            # through the actual runner gate; never recorded as product evidence.
            runner=Runner(SimpleNamespace(output=tmp,cli=None,suite="dsp"))
            def fake_render(samples,parameters=None,block=257,output="output.wav",rate=48000,mutation="identity"):
                hz = int(Path(output).stem.split("-")[-1])*rate/4096
                write_float_wav(folder/(Path(output).stem+"-input.wav"),samples,rate)
                h=eq_response(hz,rate,6,-9,3,1300,1.3)
                if mutation=="gain": h*=10**(1/20)
                if mutation=="delay": h*=cmath.exp(-2j*math.pi*hz/rate)
                if mutation=="dbfactor": h=eq_response(hz,rate,12,-18,6,1300,1.3)
                return [[.1*abs(h)*math.sin(2*math.pi*hz*n/rate+cmath.phase(h)) for n in range(len(samples[0]))]]
            runner.render=lambda *a,**k:fake_render(a[1],**k)
            self.assertTrue(runner.eq(folder))
            for mutation in ("gain","delay","dbfactor"):
                runner.render=lambda *a,**k:fake_render(a[1],mutation=mutation,**k)
                with self.assertRaises(AssertionError,msg=mutation):
                    runner.eq(folder)


if __name__=="__main__": unittest.main()
