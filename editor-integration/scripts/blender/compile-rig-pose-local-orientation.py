# SPDX-License-Identifier: GPL-2.0-or-later
"""Compile unchanged Blender single-pose LOCAL orientation math and native reference cases."""
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


orientation = read('blender-rig-object-transform', 'transform_orientations.cc')
header = read('blender-rig-pose-local-orientation', 'transform_orientations.hh')
enum = header[header.index('enum {'):header.index('\n\nint getTransformOrientation_ex')]
matrix = read('blender-transform-translation', 'math_matrix_c.cc')
vector = read('blender-transform-angle', 'math_vector_inline.c')
pose = orientation[orientation.index('else if (ob && (ob->mode & OB_MODE_POSE))'):]
a = pose.index('      add_v3_v3(normal, pchan->pose_mat[2]);')
b = pose.index('      add_v3_v3(plane, pchan->pose_mat[1]);', a) + len('      add_v3_v3(plane, pchan->pose_mat[1]);')
axes = pose[a:b]
a = pose.index('      copy_m3_m4(imat, ob->object_to_world().ptr());')
b = pose.index('      mul_m3_v3(mat, plane);', a) + len('      mul_m3_v3(mat, plane);')
normal_transform = pose[a:b]
construction = orientation[orientation.index('  /* Fallback, when the plane can\'t be calculated. */'):]
construction = construction[:construction.index('\n  if (type == ORIENTATION_NONE) {')]
fallback = orientation[orientation.index('  if (type == ORIENTATION_NONE) {', orientation.index('void ED_getTransformOrientationMatrix')):]
fallback = fallback[:fallback.index('\n  }') + len('\n  }')]

functions = [function(vector, name) for name in ['zero_v3', 'copy_v3_v3', 'add_v3_v3', 'mul_v3_v3fl',
    'negate_v3_v3', 'dot_v3v3', 'cross_v3_v3v3', 'normalize_v3_v3_length', 'normalize_v3_v3',
    'normalize_v3', 'is_zero_v3']]
functions += [function(matrix, name) for name in ['unit_m3', 'copy_m3_m3', 'copy_m3_m4',
    'mul_m3_m3m3', 'mul_v3_m3v3', 'mul_m3_v3', 'determinant_m3_array', 'adjoint_m3_m3',
    'invert_m3_m3', 'transpose_m3', 'normalize_m3']]
functions += [function(orientation, 'createSpaceNormal'), function(orientation, 'createSpaceNormalTangent')]
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
adapter = '''
static float inputs[18], result[9];
struct MatrixRef { const float (*matrix)[4]; const float (*ptr() const)[4] { return matrix; } };
struct Object { float matrix[4][4]; MatrixRef object_to_world() const { return {matrix}; } };
struct bPoseChannel { float pose_mat[3][3]; };
extern "C" uintptr_t pose_orientation_input() { return reinterpret_cast<uintptr_t>(inputs); }
extern "C" uintptr_t pose_orientation_result() { return reinterpret_cast<uintptr_t>(result); }
extern "C" int pose_orientation(int world_input) {
  Object storage{};
  bPoseChannel channel{};
  Object *ob = &storage;
  bPoseChannel *pchan = &channel;
  float bone[3][3], armature[3][3], inverse[3][3];
  for (int c=0;c<3;c++) for (int r=0;r<3;r++) {
    armature[c][r] = inputs[c*3+r];
    storage.matrix[c][r] = armature[c][r];
    bone[c][r] = inputs[9+c*3+r];
  }
  if (world_input) {
    // The host stores a displayed world matrix; restore the pose_mat input frame.
    if (!invert_m3_m3(inverse, armature)) {
      float identity[3][3]; unit_m3(identity); memcpy(result, identity, sizeof(result)); return 0;
    }
    mul_m3_m3m3(channel.pose_mat, inverse, bone);
  } else {
    copy_m3_m3(channel.pose_mat, bone);
  }
  float normal[3] = {0.0,0.0,0.0}, plane[3] = {0.0,0.0,0.0};
  float imat[3][3], mat[3][3], r_orientation_mat[3][3];
  int type = ORIENTATION_EDGE;
'''
ending = '''
  memcpy(result, r_orientation_mat, sizeof(result));
  return type != ORIENTATION_NONE;
}
'''
cpp_text = '\n\n'.join([prefix, enum, *functions, adapter, axes, normal_transform, construction, fallback, ending]) + '\n'
hashes[str(Path(__file__).relative_to(ROOT))] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
out = ROOT / '.integration-audit/rig-pose-local-orientation'
out.mkdir(parents=True, exist_ok=True)
cpp, wasm = out / 'orientation.cc', out / 'orientation.wasm'
cpp.write_text(cpp_text)
exports = ['pose_orientation_input', 'pose_orientation_result', 'pose_orientation']
subprocess.run([str(args.sdk / 'bin/clang++'), '--target=wasm32-wasip1', '-std=c++17', '-O2', '-DNDEBUG',
    '-ffp-contract=off', '-fno-exceptions', '-fno-rtti', '-nostartfiles', '-Wl,--no-entry', '-Wl,--strip-all',
    *['-Wl,--export=' + name for name in exports], str(cpp), '-o', str(wasm)], check=True)
target = ROOT / 'packages/editor/src/components/scene-camera/rig-pose-local-orientation-source.json'
target.write_text(json.dumps(dict(hashes=hashes, wasm=base64.b64encode(wasm.read_bytes()).decode(),
    wasmHash=hashlib.sha256(wasm.read_bytes()).hexdigest(), sourceBlocks=dict(poseAxes=axes,
    normalTransform=normal_transform, orientationConstruction=construction, failureFallback=fallback,
    orientationEnum=enum)), separators=(',', ':')) + '\n')

native = out / 'orientation-reference.cc'
native.write_text(cpp_text + '''
#include <iostream>
#include <iomanip>
int main() {
  int world_input;
  while (std::cin >> world_input) {
    for (float &value : inputs) std::cin >> value;
    int success = pose_orientation(world_input);
    std::cout << success << std::setprecision(10);
    for (float value : result) std::cout << " " << value;
    std::cout << "\\n";
  }
}
''')
binary = out / 'orientation-reference'
subprocess.run(['clang++', '-std=c++17', '-O2', '-DNDEBUG', '-ffp-contract=off', str(native), '-o', str(binary)], check=True)


def multiply(a, b):
    return [sum(a[k*3+r] * b[c*3+k] for k in range(3)) for c in range(3) for r in range(3)]


def rotation(yaw, pitch):
    cy, sy, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    return [cy,0,-sy, sy*sp,cp,cy*sp, sy*cp,-sp,cy*cp]


cases = []
for yaw, pitch in [(0,0),(.6,.35),(-1.2,.9)]:
    for scale in [(1,1,1),(2,.6,1.4),(-2,.6,1.4),(0,.6,1.4),(2,0,1.4),(2,.6,0)]:
        armature = multiply(rotation(yaw,pitch), [scale[0],0,0,0,scale[1],0,0,0,scale[2]])
        for angles in [(0,0),(.4,.7),(-.8,.2)]:
            for shear in [0,.4,-.6]:
                bone = multiply(rotation(*angles), [1,0,0,0,1,0,shear,0,1])
                for world_input in [0,1]:
                    cases.append(dict(worldInput=world_input, armature=armature,
                        bone=multiply(armature,bone) if world_input else bone))
for bone in [[0]*9,[1,0,0,0,0,0,0,0,1],[1,0,0,0,1,0,0,0,0],[1e-20,0,0,0,1e-20,0,0,0,1e-20]]:
    cases.append(dict(worldInput=1, armature=[1,0,0,0,1,0,0,0,1], bone=bone))
output = subprocess.check_output([str(binary)], input='\n'.join(' '.join(map(str,
    [case['worldInput'], *case['armature'], *case['bone']])) for case in cases), text=True)
assert len(output.splitlines()) == len(cases)
for case, line in zip(cases, output.splitlines()):
    values = list(map(float, line.split()))
    case['success'], case['expected'] = bool(values[0]), values[1:]
fixture = ROOT / 'tests/integration/fixtures/blender-rig-pose-local-orientation.json'
fixture.write_text(json.dumps(dict(hashes=hashes, cases=cases), separators=(',', ':')) + '\n')
print(f'Compiled original orientation/math bodies: {wasm.stat().st_size} WASM bytes; {len(cases)} native cases')
