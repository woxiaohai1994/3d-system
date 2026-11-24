# SPDX-License-Identifier: GPL-2.0-or-later
"""Compile original Blender keyframe evaluation and handle calculation to WebAssembly."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor/blender-fcurve'
parser = argparse.ArgumentParser()
parser.add_argument('--sdk', type=Path, default=ROOT / '.integration-audit/toolchains/wasi-sdk-34.0-arm64-macos')
args = parser.parse_args()
hashes = {}


def read(path):
    raw = path.read_bytes()
    hashes[str(path.relative_to(ROOT))] = hashlib.sha256(raw).hexdigest()
    manifest = json.loads((path.parent / 'UPSTREAM.json').read_text())
    assert hashes[str(path.relative_to(ROOT))] == manifest['files'][path.name]['sha256'], path
    return raw.decode()


def function(text, name):
    masked = re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', lambda m: ' ' * len(m[0]), text)
    match = re.search(r'^[\w *]+\b' + re.escape(name) + r'\([^;{}]*\)\s*\{', masked, re.M)
    if match is None:
        raise ValueError('Missing source function: ' + name)
    end, depth = match.end(), 1
    while depth:
        depth += (masked[end] == '{') - (masked[end] == '}')
        end += 1
    return text[match.start():end].strip()


def declaration(text, kind, name):
    match = re.search(r'typedef ' + kind + ' ' + name + r'\s*\{[\s\S]*?\}\s*' + name + ';', text)
    assert match, name
    return match[0]


def constants(text):
    text = re.sub(r'/\*[\s\S]*?\*/|//[^\n]*|^#[^\n]*', '', text, flags=re.M)
    result, value = {}, -1
    for item in text[text.index('{') + 1:text.rindex('}')].split(','):
        item = item.strip()
        if not item:
            continue
        if '=' in item:
            name, expression = map(str.strip, item.split('=', 1))
            expression = re.sub(r'(?<=\d)[uU](?=\s|$|\))', '', expression)
            assert re.fullmatch(r'[\d\s()<>+|\-]+', expression), expression
            value = eval(expression, {'__builtins__': {}})
        else:
            name, value = item, value + 1
        result[name] = value
    return result


curve = read(SOURCE / 'curve.cc')
fcurve = read(SOURCE / 'fcurve.cc')
dna = read(SOURCE / 'DNA_curve_types.h')
anim_dna = read(SOURCE / 'DNA_anim_types.h')
action_dna = read(SOURCE / 'DNA_action_types.h')
animrig = read(SOURCE / 'animrig_fcurve.cc')
anim_header = read(SOURCE / 'ANIM_fcurve.hh')
key_header = read(SOURCE / 'ANIM_keyframing.hh')
fcurve_header = read(SOURCE / 'BKE_fcurve.hh')
base = read(SOURCE / 'math_base_inline.c')
vectors = read(ROOT / 'vendor/blender-transform-angle/math_vector_inline.c')
solvers = read(SOURCE / 'math_solvers.c')
easing = read(SOURCE / 'easing.c')
parts = [(ROOT / 'scripts/blender/fcurve-adapter-prefix.hh').read_text()]
parts += [declaration(dna, 'struct', 'BezTriple')]
parts += [declaration(dna, 'enum', name) for name in [
    'eBezTriple_Flag', 'eBezTriple_Handle', 'eBezTriple_Auto_Type',
    'eBezTriple_Interpolation', 'eBezTriple_Easing', 'eBezTriple_KeyframeType']]
parts += [declaration(anim_dna, 'enum', name) for name in [
    'eFCurve_Flags', 'eFCurve_Extend', 'eFCurve_Smoothing', 'eInsertKeyFlags',
    'eFMod_Cycling_Modes', 'eFModifier_Types', 'eFModifier_Flags']]
parts += [declaration(action_dna, 'enum', 'eActionGroup_Flag'),
          declaration(fcurve_header, 'enum', 'eFCU_Cycle_Type'),
          declaration(anim_dna, 'struct', 'FModifier'), declaration(anim_dna, 'struct', 'FMod_Cycles')]
for name in ['BEZT_IS_AUTOH', 'BEZT_ISSEL_ANY', 'BEZKEYTYPE_LVALUE']:
    parts += [re.search(r'#define ' + name + r'\(bezt\) (?:\\\n)?[^\n]+', dna)[0]]
for text, name in [(anim_dna, 'FCURVE_ACTIVE_KEYFRAME_NONE'), (fcurve_header, 'BEZT_BINARYSEARCH_THRESH')]:
    parts += [re.search(r'^#define ' + name + r' [^\n]+', text, re.M)[0]]
parts += [re.search(r'struct KeyframeSettings \{[\s\S]*?\};', anim_header)[0],
          re.search(r'enum class SingleKeyingResult \{[\s\S]*?\};', key_header)[0]]
parts += ['using eBezTriple_Flag__Alias = int;',
          'inline eInsertKeyFlags &operator&=(eInsertKeyFlags &a, int b) { return a = eInsertKeyFlags(int(a) & b); }',
          'struct float2 { float x, y; };',
          'static constexpr struct { int ipo_new = BEZT_IPO_BEZ, keyhandles_new = HD_AUTO_ANIM; } U;',
          'struct bActionGroup { int flag; };',
          'struct FCurve { BezTriple *bezt; int totvert, flag, auto_smoothing, extend; void *fpt; int active_keyframe_index; bActionGroup *grp; struct { void *first; } modifiers; FModifier modifier; FMod_Cycles cycles; };']
parts += [function(fcurve, name) for name in ['BKE_fcurve_get_cycle_type', 'BKE_fcurve_is_cyclic', 'BKE_fcurve_is_protected']]
parts += [function(base, name) for name in ['min_ff', 'max_ff', 'sqrt3d', 'ulp_diff_ff', 'compare_ff_relative']]
parts += [function(vectors, name) for name in [
    'copy_v3_v3', 'copy_v2_v2', 'sub_v3_v3v3', 'sub_v2_v2v2', 'add_v3_v3v3', 'add_v3_v3',
    'add_v2_v2v2', 'mul_v2_fl', 'madd_v3_v3v3fl', 'dot_v3v3', 'len_v3', 'len_v3v3']]
parts += [function(read(SOURCE / 'math_vector.c'), 'interp_v2_v2v2')]
parts += [function(solvers, name) for name in ['BLI_tridiagonal_solve', 'BLI_tridiagonal_solve_cyclic']]
parts += [function(curve, 'calchandleNurb_intern')]
parts += [curve[curve.index('static void *allocate_arrays('):
                curve.index('void BKE_nurb_handle_calc(')].strip()]
parts += [function(curve, 'BKE_nurb_handle_calc_ex')]
parts += [function(fcurve, name) for name in [
    'cycle_offset_triple', 'BKE_fcurve_handles_recalc_ex', 'BKE_fcurve_handles_recalc',
    'BKE_fcurve_bezt_binarysearch_index_ex', 'BKE_fcurve_bezt_binarysearch_index', 'BKE_fcurve_correct_bezpart',
    'solve_cubic', 'findzero', 'berekeny']]
parts += [re.sub(r'^#include[^\n]*', '', easing, flags=re.M)]
parts += [function(fcurve, name) for name in [
    'fcurve_eval_keyframes_extrapolate', 'fcurve_eval_keyframes_interpolate', 'fcurve_eval_keyframes']]
parts += [function(fcurve, name) for name in ['BKE_fcurve_active_keyframe_set', 'fcurve_bezt_free',
          'BKE_fcurve_bezt_subdivide_handles', 'BKE_fcurve_delete_key']]
parts += ['static float evaluate_fcurve(const FCurve *curve, float time) { float value = curve->totvert ? fcurve_eval_keyframes(curve, curve->bezt, time) : 0.0f; return (curve->flag & FCURVE_INT_VALUES) ? floorf(value + 0.5f) : value; }']
parts += [function(animrig, name) for name in ['get_keyframe_settings', 'replace_bezt_keyframe_ypos',
          'insert_bezt_fcurve', 'subdivide_nonauto_handles', 'initialize_bezt', 'new_key_needed',
          'remap_cyclic_keyframe_location', 'insert_vert_fcurve', 'fcurve_delete_keyframe_at_time']]
parts += [(ROOT / 'scripts/blender/fcurve-adapter-api.cc').read_text()]
out = ROOT / '.integration-audit/fcurve'
out.mkdir(parents=True, exist_ok=True)
cpp, wasm = out / 'fcurve.cc', out / 'fcurve.wasm'
cpp.write_text('\n\n'.join(parts) + '\n')
command = [str(args.sdk / 'bin/clang++'), '--target=wasm32-wasip1', '-std=c++17', '-O2',
           '-ffp-contract=off', '-fno-exceptions', '-fno-rtti', '-nostartfiles',
           '-Wl,--no-entry', '-Wl,--strip-all', '-Wl,--export-memory']
exports = ['malloc', 'free', 'curve_create', 'curve_destroy', 'curve_read', 'curve_recalculate', 'curve_evaluate', 'curve_count', 'curve_insert', 'curve_delete', 'curve_find']
command += ['-Wl,--export=' + name for name in exports]
subprocess.run(command + [str(cpp), '-o', str(wasm)], check=True)
result = dict(hashes=hashes, compiler=subprocess.check_output([str(args.sdk / 'bin/clang++'), '--version'], text=True).splitlines()[0],
              wasm=base64.b64encode(wasm.read_bytes()).decode(),
              wasmHash=hashlib.sha256(wasm.read_bytes()).hexdigest())
result['constants'] = {name: value for part in parts if part.startswith(('typedef enum', 'enum class SingleKeyingResult'))
                       for name, value in constants(part).items()}
for name in ['fcurve-adapter-prefix.hh', 'fcurve-adapter-api.cc']:
    path = ROOT / 'scripts/blender' / name
    result['hashes'][str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
target = ROOT / 'packages/core/src/lib/blender-fcurve-source.json'
target.write_text(json.dumps(result, separators=(',', ':')) + '\n')
print(f'Compiled {len(cpp.read_text().splitlines())} lines, {wasm.stat().st_size} WASM bytes to {target}')
