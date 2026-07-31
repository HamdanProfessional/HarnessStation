# Vendored MMD loader

`MMDLoader` was removed from three.js in **r172**. These three files are copied
unmodified from **three.js r171** (the last release that shipped them), except
for the import paths at the top of `MMDLoader.js`, which were repointed at the
siblings here.

| File | Origin |
| --- | --- |
| `MMDLoader.js` | `examples/jsm/loaders/MMDLoader.js` |
| `MMDToonShader.js` | `examples/jsm/shaders/MMDToonShader.js` |
| `mmdparser.module.js` | `examples/jsm/libs/mmdparser.module.js` |

Licence: MIT, © three.js authors — see https://github.com/mrdoob/three.js

All 38 three core APIs it imports still exist in the version of three this app
depends on, which is why it works unchanged. If a future three upgrade breaks it,
the options are to patch these files or to drop MMD support and ask users to
convert models to VRM.

Only the loader is vendored: MMD physics (`ammo.js`) and VMD motion playback are
deliberately left out. The avatar drives morph targets directly, so it needs
geometry, materials and morphs and nothing else.
