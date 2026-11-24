# SPDX-License-Identifier: GPL-2.0-or-later
"""Execute Blender's unchanged modal-constraint handler and export its state table."""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
vendor = ROOT / 'vendor/blender-transform-constraints'


def function(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


sources = {name: (vendor / name).read_text() for name in ['transform.cc', 'transform_constraints.cc']}
handler = function(sources['transform.cc'], 'static bool transform_event_modal_constraint(')
stop = function(sources['transform_constraints.cc'], 'void stopConstraint(')
program = r'''
#include <cassert>
#include <cstdio>
#define BLI_assert assert
#define ELEM(v,a,b) ((v)==(a) || (v)==(b))
#define ARRAY_SIZE(a) (sizeof(a)/sizeof((a)[0]))
#define IFACE_(s) (s)
enum { T_NO_CONSTRAINT=1, T_2D_EDIT=2 };
enum { CON_AXIS0=1, CON_AXIS1=2, CON_AXIS2=4, CON_APPLY=8, CON_SELECT=16 };
enum { MOD_CONSTRAINT_SELECT_AXIS=1, MOD_CONSTRAINT_SELECT_PLANE=2 };
enum { O_DEFAULT=0, O_SCENE=1, O_SET=2, TREDRAW_HARD=1 };
enum { TFM_MODAL_AXIS_X, TFM_MODAL_AXIS_Y, TFM_MODAL_AXIS_Z,
       TFM_MODAL_PLANE_X, TFM_MODAL_PLANE_Y, TFM_MODAL_PLANE_Z };
int TransConvertType_SequencerImage;
struct TransInfo {
  int flag=0, modifiers=0, orient_curr=0, orient[3]={}, redraw=0, idx_max=2;
  int *data_type=nullptr;
  struct { int mode=0; char text[256]={}; } con;
  struct { int idx_max=2; } num;
};
void transform_orientations_current_set(TransInfo *t, short i) { t->orient_curr=i; }
void setUserConstraint(TransInfo *t, int mode, const char *) { t->con.mode=mode|CON_APPLY; }
void transform_gizmo_3d_model_from_constraint_and_mode_set(TransInfo *) {}
''' + stop + '\n' + handler + r'''
int main() {
  std::printf("[");
  for(int orient=0;orient<3;orient++) for(int mask=0;mask<8;mask++) for(int key=0;key<6;key++) {
    TransInfo t;
    t.orient_curr=orient;
    t.con.mode=mask ? mask|CON_APPLY : 0;
    assert(transform_event_modal_constraint(&t,key));
    std::printf("%s[%d,%d]", orient||mask||key ? "," : "", t.orient_curr,
                t.con.mode&CON_APPLY ? t.con.mode&7 : 0);
  }
  std::printf("]");
}
'''
with tempfile.TemporaryDirectory(prefix='blender-transform-constraints-') as directory:
    path = Path(directory)
    (path / 'constraints.cpp').write_text(program)
    subprocess.run(['clang++', '-std=c++17', str(path / 'constraints.cpp'), '-o', str(path / 'constraints')], check=True)
    transitions = json.loads(subprocess.check_output([str(path / 'constraints')]))
data = {
    'source': 'Blender v4.3.0 transform_event_modal_constraint and stopConstraint',
    'hashes': {name: hashlib.sha256(source.encode()).hexdigest() for name, source in sources.items()},
    'index': '(orientation * 8 + constraintMask) * 6 + key; XYZ then plane XYZ',
    'transitions': transitions,
}
(ROOT / 'packages/editor/src/components/scene-camera/rig-constraint-source.json').write_text(json.dumps(data, separators=(',', ':')) + '\n')
print('Exported', len(transitions), 'original 3D constraint transitions')
