import("stdfaust.lib");
// Memoryless bounded tanh stage. Host owns pre-emphasis, gain, tone and DC filter.
declare name "ToneScopeTanh";
declare version "0.1.0";
process = ma.tanh;
