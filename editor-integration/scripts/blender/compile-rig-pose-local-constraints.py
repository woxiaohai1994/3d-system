# SPDX-License-Identifier: GPL-2.0-or-later
"""Compile unchanged Blender 4.3 per-TransData LOCAL constraints and native cases."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import math
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--sdk', type=Path, default=ROOT / '.integration-audit/toolchains/wasi-sdk-34.0-arm64-macos')
args = parser.parse_args()
hashes = {}


def read(folder, name):
    path = ROOT / 'vendor' / folder / name
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    files = json.loads((path.parent / 'UPSTREAM.json').read_text())['files']
    entry = next(item for item in files if item['file'] == name) if isinstance(files, list) else files[name]
    assert digest == entry['sha256'], name
    hashes[str(path.relative_to(ROOT))] = digest
    return path.read_text()


def function(text, name):
    masked = re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', lambda m: ' ' * len(m[0]), text)
    match = re.search(r'^(?:MINLINE |static )?(?:void|bool|float) ' + name + r'\([^;{}]*\)\s*\{', masked, re.M)
    assert match, name
    end, depth = match.end(), 1
    while depth:
        depth += (masked[end] == '{') - (masked[end] == '}')
        end += 1
    return text[match.start():end].strip()


constraint = read('blender-transform-constraints', 'transform_constraints.cc')
matrix = read('blender-transform-translation', 'math_matrix_c.cc')
vector = read('blender-transform-angle', 'math_vector_inline.c')
blocks = {name: function(vector, name) for name in ['zero_v3', 'copy_v3_v3', 'sub_v3_v3v3', 'mul_v3_v3fl',
    'dot_v3v3', 'normalize_v3_v3_length', 'normalize_v3_v3', 'normalize_v3']}
blocks.update({name: function(matrix, name) for name in ['unit_m3', 'copy_m3_m3',
    'mul_m3_m3m3', 'mul_v3_m3v3', 'mul_m3_v3', 'determinant_m3_array', 'adjoint_m3_m3',
    'invert_m3_m3', 'normalize_m3']})
callbacks = {name: function(constraint, name) for name in ['view_vector_calc', 'applyAxisConstraintVec',
    'applyObjectConstraintVec', 'applyObjectConstraintSize', 'constraints_rotation_impl',
    'applyObjectConstraintRot']}
prefix = '''#include <cmath>
#include <cstring>
#include <cassert>
#include <cstdint>
#define MINLINE inline
#define BLI_assert(x) assert(x)
#define LIKELY(x) (x)
template<class T, class... Values> bool sourceElem(T a, Values... values) { return ((a==values)||...); }
#define ELEM(a,...) sourceElem(a,__VA_ARGS__)
'''
context = '''
enum { CON_AXIS0=1, CON_AXIS1=2, CON_AXIS2=4, CON_APPLY=8, CON_NOFLIP=16 };
enum { T_EDIT=1, T_INPUT_IS_VALUES_FINAL=2 };
enum { RV3D_ORTHO=0 };
struct NumInput { bool active; };
struct TransData { float axismtx[3][3]; };
struct TransDataContainer { TransData *data; float mat3_unit[3][3]; };
struct TransInfo {
  struct { int mode; } con;
  int flag, persp;
  NumInput num;
  float spacemtx[3][3], spacemtx_inv[3][3], center_global[3], viewinv[4][4];
  const TransDataContainer *first;
};
static bool hasNumInput(const NumInput *num) { return num->active; }
static const float (*transform_object_axismtx_get(const TransInfo *, const TransDataContainer *, const TransData *td))[3] {
  return td->axismtx;
}
#define TRANS_DATA_CONTAINER_FIRST_OK(t) ((t)->first)
static void transform_constraint_get_nearest(const TransInfo *, const float[3], float[3]) {
  // The exported Vec entry is the per-TransData phase, after the host's screen projection.
  __builtin_trap();
}
'''
adapter = '''
static float inputs[34], result[10];
extern "C" uintptr_t pose_constraints_input() { return reinterpret_cast<uintptr_t>(inputs); }
extern "C" uintptr_t pose_constraints_result() { return reinterpret_cast<uintptr_t>(result); }
extern "C" void pose_constraints(int operation, int mask, int numeric, int setup) {
  TransInfo t{};
  TransData td{};
  TransDataContainer tc{};
  tc.data=&td;
  unit_m3(tc.mat3_unit);
  t.first=&tc;
  t.con.mode=mask|CON_APPLY;
  t.num.active=numeric;
  memcpy(td.axismtx,inputs,9*sizeof(float));
  memcpy(t.spacemtx,inputs+9,9*sizeof(float));
  invert_m3_m3(t.spacemtx_inv,t.spacemtx);
  // The host supplies the world observer vector; original view_vector_calc normalizes it.
  t.persp=RV3D_ORTHO;
  copy_v3_v3(t.viewinv[2],inputs+30);
  memset(result,0,sizeof(result));
  if (operation==0) {
    normalize_m3(td.axismtx);
    memcpy(result,td.axismtx,9*sizeof(float));
  } else if (operation==1) {
    applyObjectConstraintVec(&t,&tc,&td,inputs+18,result);
  } else if (operation==2) {
    // Keyboard/UI supplies U*D*U^-1. Restore the original resize callback's D.
    float shared[3][3], temporary[3][3], size[3][3];
    memcpy(shared,inputs+21,9*sizeof(float));
    mul_m3_m3m3(temporary,t.spacemtx_inv,shared);
    mul_m3_m3m3(size,temporary,t.spacemtx);
    applyObjectConstraintSize(&t,&tc,&td,size);
    memcpy(result,size,9*sizeof(float));
  } else if (operation==3) {
    float angle=inputs[33];
    applyObjectConstraintRot(&t,setup ? nullptr : &tc,setup ? nullptr : &td,result,setup ? &angle : nullptr);
    result[3]=angle;
  }
}
'''
cpp_text = '\n\n'.join([prefix, *blocks.values(), context, *callbacks.values(), adapter]) + '\n'
hashes[str(Path(__file__).relative_to(ROOT))] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
out = ROOT / '.integration-audit/rig-pose-local-constraints'
out.mkdir(parents=True, exist_ok=True)
cpp, wasm = out / 'constraints.cc', out / 'constraints.wasm'
cpp.write_text(cpp_text)
exports = ['pose_constraints_input', 'pose_constraints_result', 'pose_constraints']
subprocess.run([str(args.sdk / 'bin/clang++'), '--target=wasm32-wasip1', '-std=c++17', '-O2', '-DNDEBUG',
    '-ffp-contract=off', '-fno-exceptions', '-fno-rtti', '-nostartfiles', '-Wl,--no-entry', '-Wl,--strip-all',
    *['-Wl,--export=' + name for name in exports], str(cpp), '-o', str(wasm)], check=True)
target = ROOT / 'packages/editor/src/components/scene-camera/rig-pose-local-constraints-source.json'
target.write_text(json.dumps(dict(hashes=hashes, wasm=base64.b64encode(wasm.read_bytes()).decode(),
    wasmHash=hashlib.sha256(wasm.read_bytes()).hexdigest(), sourceBlocks={**blocks, **callbacks}),
    separators=(',', ':')) + '\n')

native = out / 'constraints-reference.cc'
native.write_text(cpp_text + '''
#include <iostream>
#include <iomanip>
int main() {
  int operation,mask,numeric,setup;
  while (std::cin >> operation >> mask >> numeric >> setup) {
    for (float &value : inputs) std::cin >> value;
    pose_constraints(operation,mask,numeric,setup);
    std::cout << std::setprecision(10);
    for (int i=0;i<10;i++) std::cout << (i ? " " : "") << result[i];
    std::cout << "\\n";
  }
}
''')
binary = out / 'constraints-reference'
subprocess.run(['clang++', '-std=c++17', '-O2', '-DNDEBUG', '-ffp-contract=off', str(native), '-o', str(binary)], check=True)


def multiply(a, b):
    return [sum(a[k*3+r] * b[c*3+k] for k in range(3)) for c in range(3) for r in range(3)]


def rotation(yaw, pitch):
    cy, sy, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    return [cy,0,-sy, sy*sp,cp,cy*sp, sy*cp,-sp,cy*cp]


identity = [1,0,0,0,1,0,0,0,1]
raw_bones = [identity,
    multiply(rotation(.7,.4),[2,0,0,.6,.5,0,-.4,.3,1.5]),
    multiply(rotation(-.8,.5),[-2,0,0,0,.6,0,0,0,1.4]),
    [0,0,0,0,1,0,0,0,1], [1,0,0,0,1,0,0,0,0], [0]*9,
    [1e-20,0,0,0,1e-20,0,0,0,1e-20]]
spaces = [identity, rotation(.6,.35), [1,0,0,.3,1,0,.2,.4,1],
    [1,0,0,0,1,0,0,0,0]]
cases = []
for raw in raw_bones:
    cases.append(dict(operation=0,mask=0,numeric=False,setup=False,bone=raw,space=identity,
        vector=[0,0,0],sharedSize=identity,viewVector=[0,0,0],angle=0))
output = subprocess.check_output([str(binary)], input='\n'.join(' '.join(map(str,
    [0,0,0,0,*case['bone'],*identity,0,0,0,*identity,0,0,0,0])) for case in cases), text=True)
bones = [list(map(float,line.split()))[:9] for line in output.splitlines()]
for bone in bones:
    for space in spaces:
        cases.append(dict(operation=1,mask=1,numeric=False,setup=False,bone=bone,space=space,
            vector=[.8,-1.4,2.3],sharedSize=identity,viewVector=[0,0,0],angle=0))
        for mask in [1,2,4,3,5,6]:
            # Shared matrices need not be diagonal: the ABI preserves exact incoming Float32 math.
            cases.append(dict(operation=2,mask=mask,numeric=False,setup=False,bone=bone,space=space,
                vector=[0,0,0],sharedSize=multiply(space,[1.3,0,0,0,.7,0,0,0,-1.2]),
                viewVector=[0,0,0],angle=0))
    for mask in [1,2,4,3,5,6]:
        for numeric, setup in [(True,True),(False,True),(False,False)]:
            for view in [[.5,.8,1.2],[-.5,-.8,-1.2],[0,0,0]]:
                cases.append(dict(operation=3,mask=mask,numeric=numeric,setup=setup,bone=bone,
                    space=identity,vector=[0,0,0],sharedSize=identity,viewVector=view,angle=.43))
output = subprocess.check_output([str(binary)], input='\n'.join(' '.join(map(str,
    [case['operation'],case['mask'],int(case['numeric']),int(case['setup']),*case['bone'],
     *case['space'],*case['vector'],*case['sharedSize'],*case['viewVector'],case['angle']]))
    for case in cases), text=True)
assert len(output.splitlines()) == len(cases)
for case,line in zip(cases,output.splitlines()):
    case['expected'] = list(map(float,line.split()))
fixture = ROOT / 'tests/integration/fixtures/blender-rig-pose-local-constraints.json'
fixture.write_text(json.dumps(dict(hashes=hashes,cases=cases),separators=(',', ':')) + '\n')
print(f'Compiled original per-TransData constraint/math bodies: {wasm.stat().st_size} WASM bytes; {len(cases)} native cases')
