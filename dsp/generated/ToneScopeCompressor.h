/* ------------------------------------------------------------
name: "ToneScopeCompressor"
version: "0.2.0"
Code generated with Faust 2.88.0 (https://faust.grame.fr)
Compilation options: -lang cpp -fpga-mem-th 4 -light -ct 1 -cn ToneScopeCompressor -es 1 -mcd 16 -mdd 1024 -mdy 33 -double -ftz 0
------------------------------------------------------------ */

#ifndef  __ToneScopeCompressor_H__
#define  __ToneScopeCompressor_H__

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
#define FAUSTCLASS ToneScopeCompressor
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

static double ToneScopeCompressor_faustpower2_f(double value) {
	return value * value;
}

class ToneScopeCompressor : public dsp {
	
 private:
	
	double fRec1[2];
	double fRec0[2];
	int fSampleRate;
	
 public:
	ToneScopeCompressor() {
	}
	
	ToneScopeCompressor(const ToneScopeCompressor&) = default;
	
	virtual ~ToneScopeCompressor() = default;
	
	ToneScopeCompressor& operator=(const ToneScopeCompressor&) = default;
	
	void metadata(Meta* m) { 
		m->declare("compile_options", "-lang cpp -fpga-mem-th 4 -light -ct 1 -cn ToneScopeCompressor -es 1 -mcd 16 -mdd 1024 -mdy 33 -double -ftz 0");
		m->declare("filename", "compressor.dsp");
		m->declare("name", "ToneScopeCompressor");
		m->declare("version", "0.2.0");
	}

	virtual int getNumInputs() {
		return 9;
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
		for (int l0 = 0; l0 < 2; l0 = faust_wrap_add(l0, 1)) {
			fRec1[l0] = 0.0;
		}
		for (int l1 = 0; l1 < 2; l1 = faust_wrap_add(l1, 1)) {
			fRec0[l1] = 0.0;
		}
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
	
	virtual ToneScopeCompressor* clone() {
		return new ToneScopeCompressor(*this);
	}
	
	virtual int getSampleRate() {
		return fSampleRate;
	}
	
	virtual void buildUserInterface(UI* ui_interface) {
		ui_interface->openVerticalBox("ToneScopeCompressor");
		ui_interface->closeBox();
	}
	
	virtual void compute(int count, FAUSTFLOAT** RESTRICT inputs, FAUSTFLOAT** RESTRICT outputs) {
		FAUSTFLOAT* input0 = inputs[0];
		FAUSTFLOAT* input1 = inputs[1];
		FAUSTFLOAT* input2 = inputs[2];
		FAUSTFLOAT* input3 = inputs[3];
		FAUSTFLOAT* input4 = inputs[4];
		FAUSTFLOAT* input5 = inputs[5];
		FAUSTFLOAT* input6 = inputs[6];
		FAUSTFLOAT* input7 = inputs[7];
		FAUSTFLOAT* input8 = inputs[8];
		FAUSTFLOAT* output0 = outputs[0];
		FAUSTFLOAT* output1 = outputs[1];
		FAUSTFLOAT* output2 = outputs[2];
		FAUSTFLOAT* output3 = outputs[3];
		FAUSTFLOAT* output4 = outputs[4];
		for (int i0 = 0; i0 < count; i0 = faust_wrap_add(i0, 1)) {
			double fTemp0 = static_cast<double>(input7[i0]);
			double fTemp1 = 0.5 * fTemp0;
			double fTemp2 = static_cast<double>(input3[i0]);
			double fTemp3 = static_cast<double>(input2[i0]);
			double fTemp4 = std::exp(-(1e+02 / fTemp3));
			double fTemp5 = static_cast<double>(input1[i0]);
			double fTemp6 = static_cast<double>(input0[i0]);
			fRec1[0] = 0.5 * (ToneScopeCompressor_faustpower2_f(fTemp6) + ToneScopeCompressor_faustpower2_f(fTemp5)) * (1.0 - fTemp4) + fRec1[1] * fTemp4;
			double fTemp7 = 1e+01 * std::log10(std::max<double>(fRec1[0], 1e-30));
			double fTemp8 = fTemp7 - fTemp2;
			double fTemp9 = 1.0 - 1.0 / static_cast<double>(input4[i0]);
			double fTemp10 = ((((fTemp0 > 0.0) & (fTemp8 > -fTemp1)) & (fTemp8 < fTemp1)) ? 0.5 * (fTemp9 * ToneScopeCompressor_faustpower2_f(fTemp1 - fTemp2 + fTemp7) / std::max<double>(fTemp0, 1e-30)) : ((fTemp8 >= fTemp1) ? fTemp9 * fTemp8 : 0.0));
			double fTemp11 = std::exp(-(1e+03 / (fTemp3 * ((fTemp10 > fRec0[1]) ? static_cast<double>(input5[i0]) : static_cast<double>(input6[i0])))));
			fRec0[0] = fRec0[1] * fTemp11 + fTemp10 * (1.0 - fTemp11);
			double fTemp12 = std::pow(1e+01, 0.05 * (static_cast<double>(input8[i0]) - fRec0[0]));
			output0[i0] = static_cast<FAUSTFLOAT>(fTemp6 * fTemp12);
			output1[i0] = static_cast<FAUSTFLOAT>(fTemp5 * fTemp12);
			output2[i0] = static_cast<FAUSTFLOAT>(fRec1[0]);
			output3[i0] = static_cast<FAUSTFLOAT>(fRec0[0]);
			output4[i0] = static_cast<FAUSTFLOAT>(fTemp12);
			fRec1[1] = fRec1[0];
			fRec0[1] = fRec0[0];
		}
	}

};

#endif
