# Licenses

ReClonk aims to be as open as possible. What applies depends on the file:

| What | License | File |
|---|---|---|
| ReClonk's own code | ISC | [`../LICENSE`](../LICENSE) |
| Code ported from the Clonk Rage / LegacyClonk engines | ISC, keeping their copyright lines | [`clonk_engine_license.txt`](clonk_engine_license.txt) |
| Art, sound and text made for ReClonk | CC0 1.0 (public domain dedication) | https://creativecommons.org/publicdomain/zero/1.0/ |
| Original Clonk game content adapted for the *Classic* pack (not added yet) | CC BY-NC 4.0, as published by LegacyClonk | https://creativecommons.org/licenses/by-nc/4.0/ |
| The word "Clonk" | Clonk Trademark License | [`clonk_trademark_license.txt`](clonk_trademark_license.txt) |

Rules of thumb for contributors:

- Ported engine code gets a header comment naming the original file, e.g. `// Ported from C4Landscape.cpp (Clonk Rage / LegacyClonk), see licenses/clonk_engine_license.txt`.
- Anything derived from original Clonk graphics, sounds or scripts goes in the Classic content pack only, never in the engine or the CC0 base content, because it must stay non-commercial.
- Don't add Clonk content from other sources (fan packs, OpenClonk, etc.) without checking its license first.
