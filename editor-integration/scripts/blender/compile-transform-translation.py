# SPDX-License-Identifier: GPL-2.0-or-later
"""Compile source viewport translation and constraint projection, with a native C++ oracle."""
from pathlib import Path
import hashlib
import json
import math
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
hashes = {}


def read(directory, name):
    path = ROOT / 'vendor' / directory / name
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    assert json.loads((path.parent / 'UPSTREAM.json').read_text())['files'][name]['sha256'] == digest
    hashes[directory + '/' + name] = digest
    return path.read_text()


def extract(source, name):
    match = re.search(r'^(?:MINLINE |static )?(?:void|float|bool) ' + name + r'\([^;{]+\)\s*\{', source, re.M)
    assert match, name
    start, end, depth = match.start(), match.end(), 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


inputs = read('blender-transform-modes', 'transform_input.cc')
transform = read('blender-transform-constraints', 'transform.cc')
constraints = read('blender-transform-constraints', 'transform_constraints.cc')
projection = read('blender-transform-translation', 'view3d_project.cc')
geometry = read('blender-transform-translation', 'math_geom.cc')
vector = read('blender-transform-angle', 'math_vector.c')
inline = read('blender-transform-angle', 'math_vector_inline.c')
safe = read('blender-transform-angle', 'math_base_safe_inline.c')
helpers = ['mul_project_m4_v3_zfac', 'zero_v3', 'copy_v3_v3', 'sub_v3_v3v3', 'sub_v3_v3', 'add_v3_v3v3', 'mul_v3_v3fl',
           'mul_v3_fl', 'negate_v3', 'negate_v3_v3', 'dot_v3v3', 'cross_v3_v3v3',
           'len_squared_v3', 'len_v3', 'len_v3v3', 'normalize_v3_v3_length',
           'normalize_v3_v3', 'normalize_v3', 'is_zero_v3', 'madd_v3_v3v3fl']
functions = [extract(inline, name) for name in helpers]
functions += [extract(safe, 'safe_asinf')]
functions += [extract(vector, name) for name in ['angle_normalized_v3v3', 'angle_v3v3', 'project_v3_v3v3']]
functions += [extract(geometry, name) for name in ['isect_ray_ray_epsilon_v3', 'isect_ray_ray_v3', 'isect_ray_plane_v3_factor']]
functions += [extract(projection, name) for name in ['ED_view3d_calc_zfac_ex', 'ED_view3d_win_to_delta']]
# The app canvas is the VIEW3D/WINDOW, non-paint branch. Keep that original branch verbatim.
convert = extract(transform, 'convertViewVec')
branch = re.search(r'const float xy_delta\[2\].*?ED_view3d_win_to_delta\([^;]+;', convert, re.S).group(0)
functions += ['void convertViewVec(TransInfo *t, float r_vec[3], double dx, double dy) {\n' + branch + '\n}']
functions += [extract(inputs, 'InputVector')]
functions += [extract(constraints, name) for name in ['view_vector_calc', 'viewAxisCorrectCenter', 'axisProjection', 'isPlaneProjectionViewAligned', 'planeProjection']]
original = '\n\n'.join(functions)


def translate(function):
    header, body = function.split('{', 1)
    name = re.search(r'(\w+)\(', header).group(1)
    args = header[header.index('(') + 1:header.rindex(')')]
    params = []
    pointers = []
    for arg in args.split(','):
        arg = arg.strip()
        identifier = re.search(r'(\w+)(?:\[\d+\])*$', arg).group(1)
        if 'TransInfo' in arg:
            kind = 'TranslationContext'
        elif 'MouseInput' in arg:
            kind = 'VectorMouseInput'
        elif 'RegionView3D' in arg:
            kind = 'TranslationView'
        elif 'ARegion' in arg:
            kind = 'TranslationRegion'
        elif '[4][4]' in arg:
            kind = 'Mat4'
        elif '[' in arg:
            kind = 'Vec' + re.search(r'\[(\d+)\]', arg).group(1)
        elif '*' in arg:
            kind = '[boolean] | null' if 'bool' in arg else '[number]' + (' | null' if identifier in ['r_lambda_a', 'r_lambda_b'] else '')
            pointers.append(identifier)
        else:
            kind = 'number'
        params.append(identifier + ': ' + kind)
    ret = 'boolean' if re.search(r'\bbool\s+' + name, header) else 'number' if re.search(r'\bfloat\s+' + name, header) else 'void'
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    body = re.sub(r'//[^\n]*', '', body)
    body = re.sub(r'\bBLI_(?:assert|ASSERT_UNIT_V3)\([^;]+;', '', body)
    body = body.replace('RegionView3D *rv3d = static_cast<RegionView3D *>(region->regiondata);', 'const rv3d = region.regiondata;')
    body = body.replace('const float xy_delta[2] = {float(dx), float(dy)};', 'const xy_delta: Vec2 = [f(dx), f(dy)];')
    # C out-pointers become one-element reference cells; vectors retain in-place writes.
    for pointer in pointers:
        body = body.replace('*' + pointer, pointer + '[0]')
    for ref in ['factor', 'mul']:
        if '&' + ref in body:
            body = re.sub(r'\b' + ref + r'\b', ref + '[0]', body)
            body = body.replace('&' + ref + '[0]', ref)
            body = body.replace('float ' + ref + '[0];', 'const ' + ref + ': [number] = [0];')
    def declarations(match):
        items = match.group(1).split(',')
        lines = []
        for item in items:
            item = item.strip()
            if re.match(r'\w+\[3\]$', item):
                lines.append('const ' + item[:-3] + ': Vec3 = [0, 0, 0];')
            elif item in ['factor[0]', 'mul[0]']:
                lines.append('const ' + item[:-3] + ': [number] = [0];')
            else:
                lines.append('let ' + item + ' = 0;')
        return '\n'.join(lines)
    body = re.sub(r'\bfloat ((?:\w+(?:\[[03]\])?)(?:,\s*\w+(?:\[[03]\])?)*)\s*;', declarations, body)
    body = re.sub(r'\b(const )?float (\w+) =', r'let \2 =', body)
    body = body.replace('->', '.').replace('nullptr', 'null')
    body = re.sub(r'\bfloat\(', 'f(', body)
    body = body.replace('(float)M_PI', 'f(Math.PI)')
    body = body.replace('M_PI_2', '(Math.PI / 2)').replace('M_PI', 'Math.PI')
    body = re.sub(r'\b(\d+(?:\.\d*)?(?:e[+-]?\d+)?)f\b', r'\1', body)
    body = re.sub(r'\bfabsf\(', 'Math.abs(', body)
    body = re.sub(r'\bsqrtf\(', 'Math.sqrt(', body)
    body = re.sub(r'\basinf\(', 'Math.asin(', body)
    body = body.replace('isfinite(', 'Number.isFinite(')
    body = re.sub(r'CLAMP\((\w+), -1.0, 1.0\);', r'\1 = Math.max(-1, Math.min(1, \1));', body)
    body = body.replace('UNLIKELY(', '(')
    body = body.replace(' == ', ' === ').replace(' != ', ' !== ')
    # Float assignments round at C storage boundaries. Arithmetic intermediates
    # remain JS doubles; compare against separately compiled C++ with tolerances.
    body = re.sub(r'(^\s*)(r\[\d\]|r_out\[\d\]|out\[\d\]|r_lambda(?:_a|_b)?\[0\]) = ([^;]+);', r'\1\2 = Math.fround(\3);', body, flags=re.M)
    body = re.sub(r'\b(in|out)\b', lambda m: 'input' if m.group(0) == 'in' else 'output', body)
    params = [re.sub(r'^in:', 'input:', re.sub(r'^out:', 'output:', p)) for p in params]
    exported = name in ['InputVector', 'ED_view3d_calc_zfac_ex', 'axisProjection', 'isPlaneProjectionViewAligned', 'planeProjection']
    return ('export ' if exported else '') + 'function ' + name + '(' + ', '.join(params) + '): ' + ret + ' {\n' + body


adapters = '''export type Vec2 = [number, number]
export type Vec3 = [number, number, number]
type Vec4 = [number, number, number, number]
export type Mat4 = [Vec4, Vec4, Vec4, Vec4]
export type TranslationView = { persmat: Mat4; persinv: Mat4 }
export type TranslationRegion = { winx: number; winy: number; regiondata: TranslationView }
export type TranslationContext = { region: TranslationRegion; zfac: number; persp: number; spacetype: number; viewinv: [Vec3, Vec3, Vec3, Vec3]; center_global: Vec3 }
export type VectorMouseInput = { imval: Vec2 }
const f = Math.fround
const RV3D_ORTHO = 0
const SPACE_VIEW3D = 1
const FLT_MIN = 1.1754943508222875e-38
const DEG2RADF = (value: number) => f(value * Math.PI / 180)
'''
out = ROOT / 'packages/editor/src/components/scene-camera/rig-transform-translation-source.ts'
translated = '\n\n'.join(translate(fn) for fn in functions)
# Fixed-size C arrays are indexed in bounds; Mat4 columns have dynamic TS lengths.
translated = re.sub(r'(\b(?:persinv|persmat)\[\d\]\[\d\])', r'\1!', translated)
out.write_text('// SPDX-License-Identifier: GPL-2.0-or-later\n// Generated by scripts/blender/compile-transform-translation.py; do not edit.\n' +
               'export const sourceTranslationHashes = ' + json.dumps(hashes, indent=2) + '\n' + adapters + translated + '\n')
subprocess.run([str(ROOT / 'node_modules/.bin/biome'), 'check', '--write', str(out)], check=True, cwd=ROOT)

# Native original callbacks and geometry, with only application structs/macros adapted.
harness = '''#include <cmath>
#include <cfloat>
#include <cassert>
#include <iostream>
#include <iomanip>
#define MINLINE inline
#define BLI_assert(x) assert(x)
#define BLI_ASSERT_UNIT_V3(x) ((void)0)
#define UNLIKELY(x) (x)
#define CLAMP(a, lo, hi) a = std::fmin(hi, std::fmax(lo, a))
#define DEG2RADF(a) ((a) * (float(M_PI) / 180.0f))
#define SPACE_VIEW3D 1
#define RV3D_ORTHO 0
using std::isfinite;
struct RegionView3D { float persmat[4][4], persinv[4][4]; };
struct ARegion { int winx, winy; void *regiondata; };
struct TransInfo { ARegion *region; float zfac; int persp, spacetype; float viewinv[4][4], center_global[3]; };
struct MouseInput { float imval[2]; };
''' + original + '''
int main() {
  RegionView3D view{}; ARegion region{800, 600, &view}; TransInfo t{}; t.region=&region; t.spacetype=SPACE_VIEW3D;
  MouseInput mouse{}; double point[2]; float axis[3], input[3], output[3]; int kind;
  while (std::cin >> t.persp >> region.winx >> region.winy >> kind) {
    for(auto &column:view.persmat) for(float &v:column) std::cin >> v;
    for(auto &column:view.persinv) for(float &v:column) std::cin >> v;
    for(auto &column:t.viewinv) for(float &v:column) std::cin >> v;
    for(float &v:t.center_global) std::cin >> v;
    for(float &v:mouse.imval) std::cin >> v;
    for(double &v:point) std::cin >> v;
    for(float &v:axis) std::cin >> v;
    t.zfac=ED_view3d_calc_zfac_ex(&view,t.center_global,nullptr);
    InputVector(&t,&mouse,point,input);
    copy_v3_v3(output,input);
    if(kind==1) { project_v3_v3v3(output,input,axis); axisProjection(&t,axis,input,output); }
    if(kind==2) { float projected[3]; project_v3_v3v3(projected,input,axis); sub_v3_v3(output,projected);
      if(!is_zero_v3(output) && !isPlaneProjectionViewAligned(&t,axis)) planeProjection(&t,axis,input,output);
    }
    std::cout << std::setprecision(10) << t.zfac;
    for(float v:input) std::cout << " " << v;
    for(float v:output) std::cout << " " << v;
    std::cout << "\\n";
  }
}
'''
# Use rigid cameras with explicit inverse projection matrices (column-major).
def matmul(a,b):
    return [[sum(a[k][r]*b[c][k] for k in range(4)) for r in range(4)] for c in range(4)]

cases=[]
for ortho in [False, True]:
 for yaw,pitch in [(0,0),(.6,.35),(-1.2,.9)]:
  cy,sy,cp,sp=math.cos(yaw),math.sin(yaw),math.cos(pitch),math.sin(pitch)
  right=[cy,0,-sy]; up=[sy*sp,cp,cy*sp]; back=[sy*cp,-sp,cy*cp]; eye=[3,-2,10]
  world=[right+[0],up+[0],back+[0],eye+[1]]
  view=[[right[i],up[i],back[i],0] for i in range(3)]+[[-sum(axis[i]*eye[i] for i in range(3)) for axis in [right,up,back]]+[1]]
  for width,height in [(800,600),(1400,450)]:
   aspect=width/height; syproj=1/math.tan(math.radians(25)); sxproj=syproj/aspect
   if ortho:
    proj=[[1/(5*aspect),0,0,0],[0,.2,0,0],[0,0,-2/99.9,0],[0,0,-100.1/99.9,1]]
    inv=[[5*aspect,0,0,0],[0,5,0,0],[0,0,-99.9/2,0],[0,0,-100.1/2,1]]
   else:
    a=-100.1/99.9;b=-20/99.9
    proj=[[sxproj,0,0,0],[0,syproj,0,0],[0,0,a,-1],[0,0,b,0]]
    inv=[[1/sxproj,0,0,0],[0,1/syproj,0,0],[0,0,0,1/b],[0,0,-1,a/b]]
   for center in [[0,0,0],[5,2,-3],eye,[eye[i]+back[i]*.1 for i in range(3)]]:
    for delta in [[0,0],[120,70],[-80,200],[.125,-.25]]:
     for kind,axis in [(0,right),(1,right),(1,up),(1,back),(1,[1,0,0]),(1,[0,1,0]),(1,[0,0,1]),(2,right),(2,up),(2,back),(2,[0,1,0])]:
      cases.append({'persp':0 if ortho else 1,'size':[width,height],'kind':kind,'persmat':matmul(proj,view),'persinv':matmul(world,inv),'viewinv':world,'center':center,'origin':[width*.3,height*.4],'point':[width*.3+delta[0],height*.4+delta[1]],'axis':axis})
with tempfile.TemporaryDirectory(prefix='blender-translation-') as directory:
 cpp,exe=Path(directory)/'translation.cc',Path(directory)/'translation'
 cpp.write_text(harness)
 subprocess.run(['clang++','-std=c++17','-ffp-contract=off',str(cpp),'-o',str(exe)],check=True)
 lines=[]
 for c in cases:
  values=[c['persp']]+c['size']+[c['kind']]+sum(c['persmat'],[])+sum(c['persinv'],[])+sum(c['viewinv'],[])+c['center']+c['origin']+c['point']+c['axis']
  lines.append(' '.join(map(str,values)))
 rows=subprocess.check_output([str(exe)],input='\n'.join(lines),text=True).splitlines()
assert len(rows)==len(cases)
for c,row in zip(cases,rows):
 values=list(map(float,row.split()));c.update(zfac=values[0],input=values[1:4],output=values[4:])
fixture=ROOT/'tests/integration/fixtures/blender-transform-translation.json'
fixture.write_text(json.dumps({'hashes':hashes,'cases':cases},separators=(',',':'))+'\n')
print(f'Compiled viewport translation and constraint projection: {len(cases)} native C++ cases')
