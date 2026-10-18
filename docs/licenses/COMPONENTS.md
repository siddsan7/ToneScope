# Development component inventory

The manifest hashes every delivered file. bin/assistant/dependencies.json and
frontend-dependencies.json enumerate exact bundled npm identities, versions and
declared licenses. Their adjacent notices contain upstream license texts.
Frontend dependencies are gathered transitively from the locked production graph;
the broker graph comes from actual esbuild inputs, excluding Eve build tooling.

- JUCE 9.0.4: pin and route in dependencies.lock.json; JUCE-LICENSE.md and
  JUCE.spdx.json retain upstream inventory. AGPL/commercial route unselected;
  this bundle provides no public distribution authorization.
- Faust 2.88.0 generated tanh graph: generator pin in dependencies.lock.json;
  faust-maths-license.txt retains math library license and generated-code exception.
- Embedded React, Radix, Motion, Lucide and utilities: frontend inventory and
  full upstream notices from the installed production dependency graph.
- shadcn component source: shadcn-LICENSE.md (MIT).
- Unmodified Space Grotesk and Commit Mono fonts: the two OFL texts.
- WebView2 SDK is a pinned build dependency; runtime installed separately.
  Microsoft VC++ runtime and Node 24 are external, not redistributed here.

These inventories and retained notices do not constitute legal qualification.
