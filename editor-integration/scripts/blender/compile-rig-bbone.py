# SPDX-License-Identifier: GPL-2.0-or-later
"""Extract Blender BBONE batches and compile unchanged outline/color GLSL bodies."""
from pathlib import Path
import base64
import hashlib
import json
import math
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
folder = ROOT / 'vendor/blender-rig-wire'
manifest = json.loads((folder / 'UPSTREAM.json').read_text())
hashes = {}

def read(name):
    raw = (folder / name).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    assert digest == manifest['files'][name]['sha256'], name
    hashes[str((folder / name).relative_to(ROOT))] = digest
    return raw.decode()

def function(text, name):
    masked = re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', lambda m: ' ' * len(m[0]), text)
    match = re.search(r'^[\w *]+\b' + name + r'\([^;{}]*\)\s*\{', masked, re.M)
    assert match, name
    end, depth = match.end(), 1
    while depth:
        depth += (masked[end] == '{') - (masked[end] == '}')
        end += 1
    return text[match.start():end].strip()

def glsl(text):
    return re.sub(r'(?<![\w.])(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?(?![\w.])', lambda m: m[0] + 'f', text)

cache = read('draw_cache.cc')
armature = read('overlay_armature.cc')
outline = read('overlay_armature_shape_outline_geom.glsl')
outline_vertex = read('overlay_armature_shape_outline_vert.glsl')
solid = read('overlay_armature_shape_solid_vert.glsl')
solid_fragment = read('overlay_armature_shape_solid_frag.glsl')
read('overlay_armature_wire_frag.glsl')
arrays = {}
for key in ['bone_box_verts','bone_box_solid_tris','bone_box_solid_normals','bone_box_wire_lines_adjacency']:
    body = re.search(r'static const (?:float|uint) ' + key + r'\[[^;]+?=\s*\{([\s\S]*?)\n\};', cache)[1]
    body = re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', '', body)
    rows = re.findall(r'\{([^{}]+)\}', body)
    arrays[key] = [[float(v.strip().removesuffix('f')) if '.' in v else int(v.strip()) for v in row.split(',') if v.strip()] for row in rows]
assert len(arrays['bone_box_verts']) == 8
assert len(arrays['bone_box_solid_tris']) == len(arrays['bone_box_solid_normals']) == len(arrays['bone_box_wire_lines_adjacency']) == 12
shade = solid[solid.index('  /* Do lighting'):solid.index('  vec4 world_pos')]
assert 'finalColor.rgb = mix(state_color.rgb, bone_color.rgb, fac * fac);' in shade
assert 'if ((inverted == 1) == gl_FrontFacing)' in solid_fragment
assert 'return 2.0f;' in function(armature,'get_bone_wire_thickness')
assert 'wire_alpha * 0.6f' in armature
prefix = ROOT / 'scripts/blender/bbone-adapter-prefix.hh'
api = ROOT / 'scripts/blender/bbone-adapter-api.cc'
for path in [prefix,api,Path(__file__).resolve()]:
    hashes[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
parts = [prefix.read_text(),function(armature,'cp_shade_color3ub'),
         glsl(function(outline,'main').replace('void main(void)','void source_bbone_outline_main()').replace('sizeViewport.xy','sizeViewport')),
         'static void source_bbone_shade(vec3 normal,vec4 state_color,vec4 bone_color) {\n' + glsl(shade) + '\n}',api.read_text()]
out = ROOT / '.integration-audit/rig-bbone'
out.mkdir(parents=True,exist_ok=True)
cpp,wasm = out / 'bbone.cc',out / 'bbone.wasm'
cpp.write_text('\n\n'.join(parts)+'\n')
sdk = ROOT / '.integration-audit/toolchains/wasi-sdk-34.0-arm64-macos'
exports = ['bbone_input','bbone_result','bbone_outline','bbone_shade','bbone_wire_color']
subprocess.run([str(sdk/'bin/clang++'),'--target=wasm32-wasip1','-std=c++17','-O2','-DNDEBUG','-ffp-contract=off','-fno-exceptions','-fno-rtti','-nostartfiles','-Wl,--no-entry','-Wl,--strip-all',*['-Wl,--export='+name for name in exports],str(cpp),'-o',str(wasm)],check=True)
target = ROOT / 'packages/editor/src/components/scene-camera/rig-bbone-source.json'
target.write_text(json.dumps(dict(hashes=hashes,arrays=arrays,poseFillAlpha=.6,
                                 wasm=base64.b64encode(wasm.read_bytes()).decode(),wasmHash=hashlib.sha256(wasm.read_bytes()).hexdigest()),separators=(',',':'))+'\n')
print('Exported original BBONE batch +',wasm.stat().st_size,'WASM bytes')

native = out / 'bbone-reference.cc'
native.write_text(cpp.read_text() + '''
#include <cstdio>
int main() {
  int opcode;
  while (scanf("%d",&opcode)==1) {
    float params[32];
    int count=opcode==0?32:opcode==1?9:4;
    for (int i=0;i<count;i++) if (scanf("%f",params+i)!=1) return 1;
    const float *values; int length;
    if (opcode==0) {
      for (int i=0;i<28;i++) input[i]=params[i];
      length=bbone_outline(params[28],params[29],int(params[30]),int(params[31]))*4;
      values=result;
    } else if (opcode==1) {
      values=bbone_shade(params[0],params[1],params[2],params[3],params[4],params[5],params[6],params[7],params[8]);length=3;
    } else {
      values=bbone_wire_color(params[0],params[1],params[2],int(params[3]));length=3;
    }
    printf("[");
    for (int i=0;i<length;i++) printf("%s%.9g",i?",":"",values[i]);
    printf("]\\n");
  }
}
''')
binary = out / 'bbone-reference'
subprocess.run(['clang++','-std=c++17','-O2','-DNDEBUG','-ffp-contract=off',str(native),'-o',str(binary)],check=True)
cases = []
flat_vertices = [arrays['bone_box_verts'][index] for tri in arrays['bone_box_solid_tris'] for index in tri]
for perspective in [True,False]:
    for mirror in [False,True]:
        projected=[]
        for x,y,z in flat_vertices:
            view=[x*.2*(-1 if mirror else 1),y-.5,z*.2-4]
            if perspective:
                f=1/math.tan(math.radians(25))
                clip=[view[0]*f/(16/9),view[1]*f,-100.1/99.9*view[2]-.2*100/99.9,-view[2]]
            else:
                clip=[view[0]/2,view[1]/2,-2/99.9*view[2]-100.1/99.9,1]
            projected.append([*view,*clip])
        for adjacent in arrays['bone_box_wire_lines_adjacency']:
            params=[component for index in adjacent for component in projected[index]]+[1280,720,int(perspective),int(mirror)]
            cases.append(dict(opcode=0,params=params))
for normal in [[1,0,0],[-1,0,0],[0,1,0],[0,0,-1],[0,0,1]]:
    cases.append(dict(opcode=1,params=[*normal,.01,.02,.03,.3,.5,.7]))
for color in [[.1,.47,.35],[0,0,0],[1,1,1],[.99,.6,0]]:
    for offset in [-50,0,-80]:
        cases.append(dict(opcode=2,params=[*color,offset]))
output=subprocess.check_output([str(binary)],input='\n'.join(' '.join(map(str,[case['opcode'],*case['params']])) for case in cases),text=True)
assert len(output.splitlines())==len(cases)
for case,line in zip(cases,output.splitlines()):
    values=[float(value) for value in line.strip()[1:-1].split(',') if value]
    case['expected']=values if all(math.isfinite(value) for value in values) else []
(ROOT/'tests/integration/fixtures/blender-rig-bbone.json').write_text(json.dumps(dict(hashes=hashes,cases=cases),separators=(',',':'))+'\n')
print('Native C++ reference:',len(cases),'cases')
