/* ------------------------------------------------------------
name: "ToneScopeCompressor"
version: "0.1.0"
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
		m->declare("version", "0.1.0");
	}

	virtual int getNumInputs() {
		return 10;
	}
	virtual int getNumOutputs() {
		return 3;
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
		FAUSTFLOAT* input9 = inputs[9];
		FAUSTFLOAT* output0 = outputs[0];
		FAUSTFLOAT* output1 = outputs[1];
		FAUSTFLOAT* output2 = outputs[2];
		for (int i0 = 0; i0 < count; i0 = faust_wrap_add(i0, 1)) {
			double fTemp0 = static_cast<double>(input2[i0]);
			double fTemp1 = static_cast<double>(input8[i0]);
			double fTemp2 = 0.5 * fTemp1;
			double fTemp3 = static_cast<double>(input4[i0]);
			double fTemp4 = static_cast<double>(input3[i0]);
			double fTemp5 = std::exp(-(1e+02 / fTemp4));
			double fTemp6 = static_cast<double>(input1[i0]) * fTemp5 + static_cast<double>(input0[i0]) * (1.0 - fTemp5);
			double fTemp7 = 1e+01 * std::log10(std::max<double>(fTemp6, 1e-30));
			double fTemp8 = fTemp7 - fTemp3;
			double fTemp9 = 1.0 - 1.0 / static_cast<double>(input5[i0]);
			double fTemp10 = ((((fTemp1 > 0.0) & (fTemp8 > -fTemp2)) & (fTemp8 < fTemp2)) ? 0.5 * (fTemp9 * ToneScopeCompressor_faustpower2_f(fTemp7 + fTemp2 - fTemp3) / std::max<double>(fTemp1, 1e-30)) : ((fTemp8 >= fTemp2) ? fTemp9 * fTemp8 : 0.0));
			double fTemp11 = std::exp(-(1e+03 / (fTemp4 * ((fTemp10 > fTemp0) ? static_cast<double>(input6[i0]) : static_cast<double>(input7[i0])))));
			double fTemp12 = fTemp0 * fTemp11 + fTemp10 * (1.0 - fTemp11);
			output0[i0] = static_cast<FAUSTFLOAT>(std::pow(1e+01, 0.05 * (static_cast<double>(input9[i0]) - fTemp12)));
			output1[i0] = static_cast<FAUSTFLOAT>(fTemp6);
			output2[i0] = static_cast<FAUSTFLOAT>(fTemp12);
		}
	}

};

#endif
