/* ------------------------------------------------------------
name: "ToneScopeEqCoefficients"
version: "0.1.0"
Code generated with Faust 2.88.0 (https://faust.grame.fr)
Compilation options: -lang cpp -fpga-mem-th 4 -light -ct 1 -cn ToneScopeEqCoefficients -es 1 -mcd 16 -mdd 1024 -mdy 33 -double -ftz 0
------------------------------------------------------------ */

#ifndef  __ToneScopeEqCoefficients_H__
#define  __ToneScopeEqCoefficients_H__

#ifndef FAUSTFLOAT
#define FAUSTFLOAT float
#endif 

#include <algorithm>
#include <cmath>
#include <cstdint>
#ifndef FAUST_INT_WRAP
#define FAUST_INT_WRAP
inline int faust_wrap_add(int a, int b) { return int((unsigned int)a + (unsigned int)b); }
inline int faust_wrap_sub(int a, int b) { return int((unsigned int)a - (unsigned int)b); }
inline int faust_wrap_mul(int a, int b) { return int((unsigned int)a * (unsigned int)b); }
#endif


#ifndef FAUSTCLASS 
#define FAUSTCLASS ToneScopeEqCoefficients
#endif

#ifdef __APPLE__ 
#define exp10f __exp10f
#define exp10 __exp10
#endif

#if defined(_WIN32)
#define RESTRICT __restrict
#else
#define RESTRICT __restrict__
#endif


class ToneScopeEqCoefficients : public dsp {
	
 private:
	
	int fSampleRate;
	
 public:
	ToneScopeEqCoefficients() {
	}
	
	ToneScopeEqCoefficients(const ToneScopeEqCoefficients&) = default;
	
	virtual ~ToneScopeEqCoefficients() = default;
	
	ToneScopeEqCoefficients& operator=(const ToneScopeEqCoefficients&) = default;
	
	void metadata(Meta* m) { 
		m->declare("compile_options", "-lang cpp -fpga-mem-th 4 -light -ct 1 -cn ToneScopeEqCoefficients -es 1 -mcd 16 -mdd 1024 -mdy 33 -double -ftz 0");
		m->declare("filename", "eq-coefficients.dsp");
		m->declare("name", "ToneScopeEqCoefficients");
		m->declare("version", "0.1.0");
	}

	virtual int getNumInputs() {
		return 5;
	}
	virtual int getNumOutputs() {
		return 5;
	}
	
	static void classInit(int sample_rate) {
	}
	
	virtual void instanceConstants(int sample_rate) {
		fSampleRate = sample_rate;
	}
	
	virtual void instanceResetUserInterface() {
	}
	
	virtual void instanceClear() {
	}
	
	virtual void init(int sample_rate) {
		classInit(sample_rate);
		instanceInit(sample_rate);
	}
	
	virtual void instanceInit(int sample_rate) {
		instanceConstants(sample_rate);
		instanceResetUserInterface();
		instanceClear();
	}
	
	virtual ToneScopeEqCoefficients* clone() {
		return new ToneScopeEqCoefficients(*this);
	}
	
	virtual int getSampleRate() {
		return fSampleRate;
	}
	
	virtual void buildUserInterface(UI* ui_interface) {
		ui_interface->openVerticalBox("ToneScopeEqCoefficients");
		ui_interface->closeBox();
	}
	
	virtual void compute(int count, FAUSTFLOAT** RESTRICT inputs, FAUSTFLOAT** RESTRICT outputs) {
		FAUSTFLOAT* input0 = inputs[0];
		FAUSTFLOAT* input1 = inputs[1];
		FAUSTFLOAT* input2 = inputs[2];
		FAUSTFLOAT* input3 = inputs[3];
		FAUSTFLOAT* input4 = inputs[4];
		FAUSTFLOAT* output0 = outputs[0];
		FAUSTFLOAT* output1 = outputs[1];
		FAUSTFLOAT* output2 = outputs[2];
		FAUSTFLOAT* output3 = outputs[3];
		FAUSTFLOAT* output4 = outputs[4];
		for (int i0 = 0; i0 < count; i0 = faust_wrap_add(i0, 1)) {
			double fTemp0 = static_cast<double>(input0[i0]);
			int iTemp1 = fTemp0 == 1.0;
			int iTemp2 = fTemp0 == 0.0;
			double fTemp3 = 6.283185307179586 * (static_cast<double>(input1[i0]) / static_cast<double>(input4[i0]));
			double fTemp4 = std::cos(fTemp3);
			double fTemp5 = std::pow(1e+01, 0.025 * static_cast<double>(input3[i0]));
			double fTemp6 = (fTemp5 + -1.0) * fTemp4;
			double fTemp7 = std::sin(fTemp3);
			double fTemp8 = 1.414213562373095 * std::sqrt(fTemp5) * fTemp7;
			double fTemp9 = fTemp5 + fTemp8 + (1.0 - fTemp6);
			double fTemp10 = fTemp5 + fTemp6;
			double fTemp11 = fTemp10 + fTemp8 + 1.0;
			double fTemp12 = static_cast<double>(input2[i0]);
			double fTemp13 = 0.5 * (fTemp7 / (fTemp12 * fTemp5));
			double fTemp14 = ((iTemp1) ? fTemp13 + 1.0 : ((iTemp2) ? fTemp11 : fTemp9));
			double fTemp15 = 0.5 * (fTemp5 * fTemp7 / fTemp12);
			output0[i0] = static_cast<FAUSTFLOAT>(((iTemp1) ? fTemp15 + 1.0 : ((iTemp2) ? fTemp5 * fTemp9 : fTemp5 * fTemp11)) / fTemp14);
			double fTemp16 = (fTemp5 + 1.0) * fTemp4;
			double fTemp17 = fTemp5 + fTemp16 + -1.0;
			double fTemp18 = fTemp5 + (-1.0 - fTemp16);
			double fTemp19 = 2.0 * fTemp4;
			output1[i0] = static_cast<FAUSTFLOAT>(((iTemp1) ? -fTemp19 : ((iTemp2) ? 2.0 * fTemp5 * fTemp18 : -(2.0 * fTemp5 * fTemp17))) / fTemp14);
			double fTemp20 = fTemp10 + (1.0 - fTemp8);
			double fTemp21 = fTemp5 + (1.0 - (fTemp6 + fTemp8));
			output2[i0] = static_cast<FAUSTFLOAT>(((iTemp1) ? 1.0 - fTemp15 : ((iTemp2) ? fTemp5 * fTemp21 : fTemp5 * fTemp20)) / fTemp14);
			output3[i0] = static_cast<FAUSTFLOAT>(((iTemp1) ? -fTemp19 : ((iTemp2) ? -(2.0 * fTemp17) : 2.0 * fTemp18)) / fTemp14);
			output4[i0] = static_cast<FAUSTFLOAT>(((iTemp1) ? 1.0 - fTemp13 : ((iTemp2) ? fTemp20 : fTemp21)) / fTemp14);
		}
	}

};

#endif
