# Development

Run `scripts/bootstrap.ps1`, then `.tools/python/cmake/data/bin/cmake.exe --preset windows-dev`, build with `--build --preset windows-dev`, and run `.tools/python/cmake/data/bin/ctest.exe --preset windows-dev`. The compiler is MSVC x64 from Visual Studio 2022. No global CMake install is necessary.

Run `scripts/tonescope.ps1 eval --suite contracts --output artifacts/contracts` and DSP/integration equivalents. Evaluation reports retain blocked requirements; a development test pass is not release qualification. Use independent references; never change thresholds to match output. Before review inspect the diff and supply exact checks and limitations.

The main agent integrates worker files after substantive independent review. User or assigned reviewer review is required before merge/deployment. Work is currently uncommitted for review. Never publish user audio, purchase dependencies, or select a commercial license on the user's behalf.
