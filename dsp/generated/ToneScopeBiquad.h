/* ------------------------------------------------------------
name: "ToneScopeBiquad"
version: "0.1.0"
Code generated with Faust 2.88.0 (https://faust.grame.fr)
Compilation options: -lang cpp -fpga-mem-th 4 -light -ct 1 -cn ToneScopeBiquad -es 1 -mcd 16 -mdd 1024 -mdy 33 -double -ftz 0
------------------------------------------------------------ */

#ifndef  __ToneScopeBiquad_H__
#define  __ToneScopeBiquad_H__

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
#define FAUSTCLASS ToneScopeBiquad
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


class ToneScopeBiquad : public dsp {
	
 private:
	
	int fSampleRate;
	
 public:
	ToneScopeBiquad() {
	}
	
	ToneScopeBiquad(const ToneScopeBiquad&) = default;
	
	virtual ~ToneScopeBiquad() = default;
	
	ToneScopeBiquad& operator=(const ToneScopeBiquad&) = default;
	
	void metadata(Meta* m) { 
		m->declare("compile_options", "-lang cpp -fpga-mem-th 4 -light -ct 1 -cn ToneScopeBiquad -es 1 -mcd 16 -mdd 1024 -mdy 33 -double -ftz 0");
		m->declare("filename", "biquad.dsp");
		m->declare("name", "ToneScopeBiquad");
		m->declare("version", "0.1.0");
	}

	virtual int getNumInputs() {
		return 8;
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
	
	virtual ToneScopeBiquad* clone() {
		return new ToneScopeBiquad(*this);
	}
	
	virtual int getSampleRate() {
		return fSampleRate;
	}
	
	virtual void buildUserInterface(UI* ui_interface) {
		ui_interface->openVerticalBox("ToneScopeBiquad");
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
		FAUSTFLOAT* output0 = outputs[0];
		FAUSTFLOAT* output1 = outputs[1];
		FAUSTFLOAT* output2 = outputs[2];
		for (int i0 = 0; i0 < count; i0 = faust_wrap_add(i0, 1)) {
			double fTemp0 = static_cast<double>(input0[i0]);
			double fTemp1 = static_cast<double>(input1[i0]) + fTemp0 * static_cast<double>(input3[i0]);
			output0[i0] = static_cast<FAUSTFLOAT>(fTemp1);
			output1[i0] = static_cast<FAUSTFLOAT>(static_cast<double>(input2[i0]) + fTemp0 * static_cast<double>(input4[i0]) - static_cast<double>(input6[i0]) * fTemp1);
			output2[i0] = static_cast<FAUSTFLOAT>(fTemp0 * static_cast<double>(input5[i0]) - static_cast<double>(input7[i0]) * fTemp1);
		}
	}

};

#endif
