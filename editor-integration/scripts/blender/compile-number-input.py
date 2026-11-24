# SPDX-License-Identifier: GPL-2.0-or-later
"""Compile unchanged Blender scalar number/slider dragging and soft-range functions."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--sdk', type=Path, default=ROOT / '.integration-audit/toolchains/wasi-sdk-34.0-arm64-macos')
args = parser.parse_args()
hashes = {}


def read(name, folder='blender-property-decorators'):
    path = ROOT / 'vendor' / folder / name
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    manifest = json.loads((path.parent / 'UPSTREAM.json').read_text())
    assert digest == manifest['files'][name]['sha256'], name
    hashes[str(path.relative_to(ROOT))] = digest
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


handlers, interface, header = (read(name) for name in ['interface_handlers.cc', 'interface.cc', 'UI_interface_c.hh'])
event_body = function(handlers, 'ui_do_but_NUM')
assert 'fac = 1.0f;\n      if (event->modifier & KM_SHIFT) {\n        fac /= 10.0f;\n      }' in event_body
assert 'data->draglastx = mx;' in event_body
prefix = ROOT / 'scripts/blender/number-adapter-prefix.hh'
api = ROOT / 'scripts/blender/number-adapter-api.cc'
parts = [prefix.read_text()]
base = read('math_base_inline.c', 'blender-fcurve')
parts.append(re.search(r'#define _round_clamp_fl_impl\(arg, ty, min, max\)[\s\S]*?(?=\n#define)', base)[0])
parts.append('static ' + re.search(r'int round_fl_to_int_clamp\(float a\)\{[^}]+\}', base)[0])
parts.append(re.search(r'#define _round_fl_impl\(arg, ty\)[\s\S]*?(?=\n#define)', base)[0])
parts.append('static ' + re.search(r'int round_fl_to_int\(float a\)\{[^}]+\}', base)[0])
for text, name in [(handlers, 'BUTTON_DRAGLOCK_THRESH'), (handlers, 'UI_PROP_SCALE_LOG_MIN'),
                   (handlers, 'UI_PROP_SCALE_LOG_SNAP_OFFSET'), (handlers, 'UI_DRAG_MAP_SOFT_RANGE_PIXEL_MAX'),
                   (header, 'UI_PRECISION_FLOAT_SCALE')]:
    parts.append(re.search(r'^#define ' + name + r' [^\n]+', text, re.M)[0])
parts.append(re.search(r'enum eSnapType \{[^}]+\};', handlers)[0])
parts += [function(interface, name) for name in ['ui_but_scale_type', 'soft_range_round_up', 'soft_range_round_down', 'ui_but_range_set_soft']]
parts += [function(handlers, name) for name in ['ui_event_to_snap', 'ui_but_dragedit_update_mval',
          'ui_numedit_begin_set_values', 'ui_numedit_begin', 'ui_numedit_apply_snapf', 'ui_numedit_apply_snap', 'ui_numedit_but_NUM']]
parts += [function(handlers, name) for name in ['ui_mouse_scale_warp_factor', 'ui_mouse_scale_warp', 'ui_numedit_but_SLI']]
parts += [function(handlers, name) for name in ['ui_event_is_snap', 'ui_numedit_set_active', 'ui_do_but_NUM', 'ui_do_but_SLI']]
widgets = read('interface_widgets.cc')
for name in ['g_shape_preset_number_arrow_vert', 'g_shape_preset_number_arrow_face']:
    parts.append(re.search(r'static const (?:float|uint) ' + name + r'\[[^;]+;', widgets)[0])
parts += [function(widgets, name) for name in ['shape_preset_init_trias_ex', 'shape_preset_init_number_arrows']]
parts += [api.read_text()]
out = ROOT / '.integration-audit/number-input'
out.mkdir(parents=True, exist_ok=True)
cpp, wasm = out / 'number.cc', out / 'number.wasm'
cpp.write_text('\n\n'.join(parts) + '\n')
exports = ['number_units', 'number_begin', 'number_move', 'number_value', 'number_changed', 'number_locked', 'number_start_x', 'number_soft_min', 'number_soft_max', 'number_bounds', 'number_event', 'number_state', 'number_cancel', 'number_arrow_vertex']
command = [str(args.sdk / 'bin/clang++'), '--target=wasm32-wasip1', '-std=c++17', '-O2', '-DNDEBUG',
           '-ffp-contract=off', '-fno-exceptions', '-fno-rtti', '-nostartfiles',
           '-Wl,--no-entry', '-Wl,--strip-all']
subprocess.run(command + ['-Wl,--export=' + name for name in exports] + [str(cpp), '-o', str(wasm)], check=True)
for path in [prefix, api]:
    hashes[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
target = ROOT / 'packages/editor/src/components/scene-camera/rig-number-source.json'
target.write_text(json.dumps(dict(hashes=hashes, wasm=base64.b64encode(wasm.read_bytes()).decode(),
                                 wasmHash=hashlib.sha256(wasm.read_bytes()).hexdigest()), separators=(',', ':')) + '\n')
print(f'Compiled {len(cpp.read_text().splitlines())} original/adapted lines, {wasm.stat().st_size} WASM bytes')

native = out / 'number-reference.cc'
native.write_text(cpp.read_text() + '''
#include <cstdio>
int main() {
  double value; float lo, hi, slo, shi, step, width, array_min, array_max; int precision, scale, floating, warp, x, is_array, count, mode;
  while (scanf("%d %lf %f %f %f %f %f %d %d %d %d %d %f %d %f %f %d", &mode, &value, &lo, &hi, &slo, &shi, &step,
               &precision, &scale, &floating, &warp, &x, &width, &is_array, &array_min, &array_max, &count) == 17) {
    number_begin(value, lo, hi, slo, shi, step, precision, scale, floating, warp, x, width, is_array, array_min, array_max);
    if (mode) { float left, w, h; if (scanf("%f %f %f", &left, &w, &h) != 3) return 1; number_bounds(left,w,h); }
    printf("[");
    for (int i=0; i<count; i++) {
      int mx, motion, ctrl, shift;
      if (scanf("%d %d %d %d", &mx, &motion, &ctrl, &shift) != 4) return 1;
      int changed = mode ? number_event(mx, motion, ctrl, shift) : number_move(mx, motion, ctrl, shift);
      printf("%s[%.17g,%d,%d,%d,%d,%.17g,%.17g", i ? "," : "", number_value(), changed,
             number_changed(), number_locked(), number_start_x(), number_soft_min(), number_soft_max());
      if (mode) printf(",%d,%d", number_state(), number_cancel());
      printf("]");
    }
    printf("]\\n");
  }
}
''')
binary = out / 'number-reference'
subprocess.run(['clang++', '-std=c++17', '-O2', '-DNDEBUG', '-ffp-contract=off', str(native), '-o', str(binary)], check=True)
configs = [
    [47, 1, 1e6, 1, 5000, 1, 3, 0, 1],
    [999, 1, 1000, 1, 1000, 10, 2, 0, 1],
    [7000, 1, 1e6, 1, 5000, 1, 3, 0, 1],
    [-2, -100, 100, -1, 1, 10, 3, 0, 1],
    [0.5, 0, 1, 0, 1, 1, 3, 0, 1],
    [0.1, 0, 1000, 0, 100, 10, 3, 2, 1],
    [4, 0, 100, 0, 100, 10, 3, 1, 1],
    [-4, -100, 100, -100, 100, 10, 3, 1, 1],
    [5, -10, 10, -10, 10, 1, 0, 0, 0],
    [25, 0, 100, 0, 100, 1, 0, 0, 0],
    [500, 0, 1000, 0, 1000, 1, 0, 0, 0],
]
moves = [[0,1,0,0], [3,1,0,0], [4,1,0,0], [54,1,0,0], [104,1,0,0],
         [104,0,0,1], [154,1,0,1], [154,0,1,1], [154,0,1,0], [124,1,1,0],
         [-196,1,0,0], [20004,1,0,0], [20003,1,0,0], [-20004,1,0,0], [-20003,1,0,0]]
cases, lines = [], []
for config in configs:
    for warp in [0, 1]:
        for start in [0, 125]:
            params = config + [warp, start, 0, 0, 0, 0]
            events = [[m[0] + start, *m[1:]] for m in moves]
            cases.append(dict(params=params, events=events))
            lines.append(' '.join(map(str, [0, *params, len(events), *[v for m in events for v in m]])))
slider_configs = [
    [0.5, 0, 1, 0, 1, 10, 3, 0, 1],
    [1.5, -1000, 1000, 0, 1, 1, 3, 0, 1],
    [5, 0, 20, 0, 20, 10, 3, 0, 1],
    [100, 0, 1000, 0, 1000, 10, 3, 0, 1],
    [0.5, 0, 1, 0, 1, 10, 3, 1, 1],
    [1, 0.1, 100, 0.1, 100, 10, 3, 2, 1],
    [3, -10, 10, -10, 10, 1, 0, 0, 0],
]
for config in slider_configs:
    for width in [80, 160, 240]:
        for start in [0, 125]:
            params = config + [0, start, width, 0, 0, 0]
            events = [[m[0] + start, *m[1:]] for m in moves]
            cases.append(dict(params=params, events=events))
            lines.append(' '.join(map(str, [0, *params, len(events), *[v for m in events for v in m]])))
# Each selected component shares its soft range with all values in the RNA array.
for bounds in [[1, 1], [-1200, 2500], [-0.5, 8000]]:
    for floating in [0, 1]:
        for warp in [0, 1]:
            params = [1, -10000, 10000, -1000, 1000, 10, 3, 0, floating, warp, 125, 0, 1, *bounds]
            events = [[m[0] + 125, *m[1:]] for m in moves]
            cases.append(dict(params=params, events=events))
            lines.append(' '.join(map(str, [0, *params, len(events), *[v for m in events for v in m]])))
output = subprocess.check_output([str(binary)], input='\n'.join(lines), text=True)
for case, line in zip(cases, output.splitlines()):
    case['states'] = json.loads(line)
assert len(output.splitlines()) == len(cases)
(ROOT / 'tests/integration/fixtures/blender-number-input.json').write_text(json.dumps(dict(hashes=hashes, cases=cases), separators=(',', ':')) + '\n')
print(f'Native C++ reference: {len(cases)} cases / {len(cases)*len(moves)} events')

event_cases, event_lines = [], []
sequences = {
    'left-arrow': [[0,101,0,0], [1,101,0,0]],
    'right-arrow': [[0,259,0,0], [1,259,0,0]],
    'text-center': [[0,180,0,0], [1,180,0,0]],
    'ctrl-text': [[0,101,1,0]],
    'drag-release': [[0,180,0,0], [2,185,0,0], [2,210,0,0], [2,220,0,1], [1,220,0,1]],
    'drag-escape': [[0,180,0,0], [2,185,0,0], [2,210,0,0], [5,210,0,0]],
    'drag-right-cancel': [[0,180,0,0], [2,185,0,0], [2,210,0,0], [6,210,0,0]],
    'ctrl-snap': [[0,180,0,0], [2,185,0,0], [2,212,0,0], [3,212,1,0], [4,212,1,1], [1,212,1,1]],
    'minus': [[8,180,0,0]],
    'wheel-down': [[9,180,1,0]],
    'wheel-up': [[10,180,1,0]],
    'wheel-plain': [[10,180,0,0]],
    'enter-text': [[7,180,0,0]],
}
for config in configs + slider_configs:
    for slider in [False, True]:
        if slider and config[7] == 2 and config[3] <= 0: continue
        params = config + [1,180,160 if slider else 0,0,0,0]
        for label, events in sequences.items():
            bounds = [100,160,24]
            event_cases.append(dict(label=label,params=params,bounds=bounds,events=events))
            event_lines.append(' '.join(map(str,[1,*params,len(events),*bounds,*[v for m in events for v in m]])))
output = subprocess.check_output([str(binary)],input='\n'.join(event_lines),text=True)
for case,line in zip(event_cases,output.splitlines()): case['states']=json.loads(line)
assert len(output.splitlines()) == len(event_cases)
(ROOT / 'tests/integration/fixtures/blender-number-events.json').write_text(json.dumps(dict(hashes=hashes,cases=event_cases),separators=(',', ':'))+'\n')
print(f'Native UI event reference: {len(event_cases)} cases')
