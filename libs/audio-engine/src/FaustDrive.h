#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <math.h>
// Minimal host-side interfaces used by this generated, control-free Faust graph.
namespace tonescope_faust {
struct dsp { virtual ~dsp() = default; };
struct Meta { void declare(const char*,const char*) {} };
struct UI { void openVerticalBox(const char*) {} void closeBox() {} };
#include "ToneScopeDrive.h"
}
