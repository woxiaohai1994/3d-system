# SPDX-License-Identifier: GPL-2.0-or-later
"""Execute Blender's original drawArrow C++ with a vertex-recording GPU adapter."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / 'vendor/blender-transform-cursor/transform_draw_cursors.cc').read_text()
fragment = source[source.index('enum eArrowDirection'):source.index('bool transform_draw_cursor_poll')]
program = r'''
#include <cmath>
#include <cstdio>
using uint = unsigned int;
struct { float pixelsize; } U = {1};
#define UI_SCALE_FAC 1.0f
#define ELEM(v,a,b) ((v)==(a) || (v)==(b))
#define GPU_PRIM_LINES 0
static bool first;
void immBegin(int, int) { first = true; std::printf("["); }
void immEnd() { std::printf("]"); }
void immVertex2f(uint, float x, float y) {
  std::printf("%s[%.9g,%.9g]", first ? "" : ",", x, y); first = false;
}
''' + fragment + r'''
int main() {
  std::printf("{");
  const char* names[] = {"up", "down", "left", "right"};
  for (int i=0; i<4; i++) {
    std::printf("%s\"%s\":", i ? "," : "", names[i]);
    drawArrow(0, eArrowDirection(i));
  }
  std::printf(",\"arrowWidth\":%g,\"dashWidth\":%g,\"dashLength\":%g}", double(ARROW_WIDTH), double(DASH_WIDTH), double(DASH_LENGTH));
}
'''
with tempfile.TemporaryDirectory(prefix='blender-transform-cursor-') as directory:
    path = Path(directory)
    (path/'cursor.cpp').write_text(program)
    subprocess.run(['clang++', '-std=c++17', str(path/'cursor.cpp'), '-o', str(path/'cursor')], check=True)
    data = json.loads(subprocess.check_output([str(path/'cursor')]))
data['sourceHash'] = hashlib.sha256(source.encode()).hexdigest()
data['source'] = 'Blender v4.3.0 transform_draw_cursors.cc drawArrow'
(ROOT/'packages/editor/src/components/scene-camera/rig-transform-cursor-source.json').write_text(json.dumps(data, indent=2)+'\n')
print('Exported four unmodified Blender transform arrows')
