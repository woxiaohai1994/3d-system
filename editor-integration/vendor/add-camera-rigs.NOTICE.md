# Add Camera Rigs

Upstream: https://github.com/waylow/add_camera_rigs
Version: 1.9.0
Commit: f87b8b6d221b6eff3bb6e3a403e359d516cc210c
Copyright: Wayne Dixon and contributors; see individual upstream SPDX copyright headers.
License: GNU General Public License, version 3 or any later version (GPL-3.0-or-later).

The files under add-camera-rigs/ are vendored unchanged. The adjacent GPL text and this notice are packaging additions. The native source data, expression/constraint evaluator, operator port and original widget geometry are derivative integration work under GPL-3.0-or-later. Their modified TypeScript/Three.js implementation is supplied in this repository. The rest of the repository retains its existing notices; this notice does not relicense upstream components.

The runtime has no Blender dependency. The Blender extraction script is a development tool. Source-to-native mappings and reproduction instructions are in docs/camera-rigs.md.

The additional composition-guide and camera-distance adapters port Blender Authors' GPL-2.0-or-later code from Blender 4.2 `view3d_draw.cc`, `interface_draw.cc`, `overlay_extra.cc`, `draw_cache.cc` and `overlay_extra_vert.glsl`. Their adapted TypeScript implementation is distributed here under GPL-3.0-or-later. Links and behavior mappings are recorded in docs/camera-rigs.md.
