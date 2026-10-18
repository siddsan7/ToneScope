# Faust generated DSP notices

Generator: GRAME Faust 2.88.0, https://faust.grame.fr/ ; pinned Windows compiler is a build tool and is not linked into ToneScope.

The checked-in generated ToneScopeDrive.h is emitted from dsp/faust/drive.dsp with the arguments in dsp/generated/manifest.json. Its math dependency metadata names GRAME Faust Math Library 2.9.0, LicenseRef-LGPL-2.1-or-later-with-Faust-exception. The original copyright, library license notice and generated-code exception from pinned maths.lib are reproduced verbatim in faust-maths-license.txt. Upstream source: https://github.com/grame-cncm/faustlibraries/blob/master/maths.lib . The generated-code exception text is part of the preserved notice; this document does not change it.

To verify reproducibility run dsp/faust/verify-generated.ps1 with the pinned Faust path. Generated headers must not be edited manually. The tiny host interfaces in FaustDrive.h are authored project code; no Faust architecture headers are copied or linked.
