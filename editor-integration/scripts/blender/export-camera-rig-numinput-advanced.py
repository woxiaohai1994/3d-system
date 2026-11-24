# SPDX-License-Identifier: GPL-2.0-or-later
"""Call actual Blender C functions for expression and scene-unit numeric input oracles."""
import bpy
import ctypes
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor/blender-numinput-python-oracle'
manifest = json.loads((SOURCE / 'UPSTREAM.json').read_text())
assert bpy.app.version_string == manifest['native_blender'], 'Unknown native ABI: inspect matching source before export'
assert bpy.app.build_hash.decode() == manifest['native_build_hash'], 'Unknown build: do not guess a private C ABI'
for name, entry in manifest['files'].items():
    raw = (SOURCE / name).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == entry['sha256'], name

library = ctypes.PyDLL(None)
double_pointer = ctypes.POINTER(ctypes.c_double)
string_array = ctypes.POINTER(ctypes.c_char_p)
symbols = {
    'PyC_RunString_AsNumber': '_ZN7blender22PyC_RunString_AsNumberEPPKcS1_S1_Pd',
    'BPY_run_string_as_number': '_ZN7blender24BPY_run_string_as_numberEPNS_8bContextEPPKcS3_PNS_14BPy_RunErrInfoEPd',
    'user_string_to_number': '_ZN7blender21user_string_to_numberEPNS_8bContextEPKcRKNS_12UnitSettingsEiPdS7_bPPc',
    'BKE_unit_string_contains_unit': '_ZN7blender29BKE_unit_string_contains_unitEPKci',
    'BKE_unit_replace_string': '_ZN7blender23BKE_unit_replace_stringEPciPKcdii',
    'BKE_unit_value_scale': '_ZN7blender20BKE_unit_value_scaleERKNS_12UnitSettingsEid',
    'BKE_unit_apply_preferred_unit': '_ZN7blender29BKE_unit_apply_preferred_unitERKNS_12UnitSettingsEid',
}


def bind(name, arguments, result):
    function = getattr(library, symbols[name])
    function.argtypes = arguments
    function.restype = result
    return function


pyc = bind('PyC_RunString_AsNumber', [string_array, ctypes.c_char_p, ctypes.c_char_p, double_pointer], ctypes.c_bool)
bpy_number = bind('BPY_run_string_as_number', [ctypes.c_void_p, string_array, ctypes.c_char_p, ctypes.c_void_p, double_pointer], ctypes.c_bool)
user_number = bind('user_string_to_number', [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_int, double_pointer, double_pointer, ctypes.c_bool, string_array], ctypes.c_bool)
contains = bind('BKE_unit_string_contains_unit', [ctypes.c_char_p, ctypes.c_int], ctypes.c_bool)
replace = bind('BKE_unit_replace_string', [ctypes.c_void_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_double, ctypes.c_int, ctypes.c_int], ctypes.c_bool)
scale_value = bind('BKE_unit_value_scale', [ctypes.c_void_p, ctypes.c_int, ctypes.c_double], ctypes.c_double)
preferred_value = bind('BKE_unit_apply_preferred_unit', [ctypes.c_void_p, ctypes.c_int, ctypes.c_double], ctypes.c_double)
SENTINEL = 123.456


def run_python(expression):
    output = ctypes.c_double(SENTINEL)
    try:
        success = pyc(None, expression.encode(), b'<expr as number>', ctypes.byref(output))
        return dict(expression=expression, success=success, value=output.value if success else None,
                    output_cell_after_call=output.value)
    except Exception as error:
        # PyDLL detects the actual pending PyErr from the native function, then raises it in Python.
        return dict(expression=expression, success=False, value=None,
                    output_cell_after_call=output.value, exception_type=type(error).__name__, exception=str(error))


def run_bpy(expression):
    output = ctypes.c_double(SENTINEL)
    success = bpy_number(bpy.context.as_pointer(), None, expression.encode(), None, ctypes.byref(output))
    return dict(expression=expression, success=success, value=output.value if success else None,
                output_cell_after_call=output.value)


def run_user(name, category, expression, system='NONE', rotation='DEGREES', length='ADAPTIVE', scale=1):
    unit = bpy.context.scene.unit_settings
    unit.system = system
    unit.system_rotation = rotation
    unit.length_unit = length
    unit.scale_length = scale
    unit_pointer = unit.as_pointer()
    type_index = list(bpy.utils.units.categories).index(category)
    system_index = list(bpy.utils.units.systems).index(system)
    encoded = expression.encode()
    unit_scale = scale_value(unit_pointer, type_index, 1)
    has_units = contains(encoded, type_index)
    transformed = ctypes.create_string_buffer(encoded, 256)
    changed = replace(transformed, 256, encoded, unit_scale, system_index, type_index)
    output = ctypes.c_double(SENTINEL)
    raw_output = ctypes.c_double(SENTINEL)
    success = user_number(bpy.context.as_pointer(), encoded, unit_pointer, type_index,
                          ctypes.byref(output), ctypes.byref(raw_output), True, None)
    return dict(
        name=name, category=category, expression=expression, type=type_index,
        units=dict(system=unit.system, rotation=unit.system_rotation, length=unit.length_unit,
                   scale_length=unit.scale_length),
        contains_unit=has_units, unit_scale=unit_scale,
        preferred_unit_scalar=preferred_value(unit_pointer, type_index, 1),
        unit_replace_changed=changed, unit_replace_expression=transformed.value.decode(),
        actual_python_expression=transformed.value.decode() if has_units else expression,
        success=success, value=output.value if success else None,
        output_cell_after_call=output.value, output_without_units_5_2=raw_output.value,
    )


expressions = [
    '', ' ', '0', '2+3', '-2**2', '(-2)**2', '2**3**2', '5//2', '-5//2', '-5%2', '5%-2',
    '2^3', '2**-2', '1/3', 'True', 'False', "'2'", '[1,2]', '(1,2)', '1,2', '()', "(1,'2')",
    "(1,float('inf'))", '(1e308,1e308)', '1e309', "float('inf')", "float('-inf')", "float('nan')",
    'inf', 'nan', '10**400', '1e100', '1/0', 'sqrt(-1)', 'sqrt(4)', 'sin(pi/2)', 'pi/2', 'e', 'tau',
    'abs(-3)', 'sum((1,2,3))', 'sum([1,2,3])', 'round(2.5)', 'min(4,2)', 'max(4,2)', 'pow(2,3)',
    "len('abc')", "int('12')", "float('2')", 'complex(1,2)', '{1:2}', 'None',
    "__name__ == '__main__'", "__file__ == '<expr as number>'", "'sqrt' in globals()",
    "'math' in globals()", "'bpy' in globals()", "type(__builtins__).__name__ == 'dict'",
    "__import__('math').pi", "getattr(__import__('math'),'sqrt')(4)", "'__import__' in __builtins__",
    'math.pi', 'bpy.app.version', '=', '*', '2+3\n99', 'degrees(pi)', 'radians(90)',
]
python_cases = [run_python(expression) for expression in expressions]
bpy_cases = [run_bpy(expression) for expression in ['', ' ', '1,2', "float('inf')", "'2'", 'sqrt(4)']]
unit_cases = []
for name, category in [('G', 'LENGTH'), ('R', 'ROTATION'), ('S', 'NONE')]:
    for expression in ['2+3', 'pi/2', '1,2', '-2**2', '-5%2', '5//2', '2^3', 'sin(pi/2)',
                       '1e309', "float('inf')", '1e100', '[1,2]', "'2'", '=', '*', '2+3\n99']:
        unit_cases.append(run_user(name, category, expression))

for expression in ['2m', '2+2cm', '2+2in', '-1m50cm']:
    unit_cases.append(run_user('G', 'LENGTH', expression))
    unit_cases.append(run_user('G', 'LENGTH', expression, system='METRIC'))
for expression in ['2m', '2', '2cm']:
    unit_cases.append(run_user('G', 'LENGTH', expression, system='METRIC', length='METERS', scale=.01))
unit_cases.append(run_user('G', 'LENGTH', '2', system='METRIC', length='CENTIMETERS'))
unit_cases.append(run_user('G', 'LENGTH', '2', system='NONE', scale=.01))
for expression in ['2', '1ft6in', '-1ft6in', '2+2cm']:
    unit_cases.append(run_user('G', 'LENGTH', expression, system='IMPERIAL', length='FEET'))

for rotation in ['DEGREES', 'RADIANS']:
    for expression in ['pi/2', 'pi/2 rad', '90d', '90°', '90degree', '90degrees', '1rad',
                       'degrees(pi)', 'radians(90)', 'atan2(1,1)', '1,2']:
        unit_cases.append(run_user('R', 'ROTATION', expression, rotation=rotation))
for expression in ['2cm', '90°', '1rad', 'degrees(pi)', 'radians(90)']:
    unit_cases.append(run_user('S', 'NONE', expression))

fixture = dict(
    blender=bpy.app.version_string, build_hash=bpy.app.build_hash.decode(), python=sys.version,
    platform=sys.platform, native_binary_sha256=hashlib.sha256(Path(bpy.app.binary_path).read_bytes()).hexdigest(),
    exporter_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    source_manifest_sha256=hashlib.sha256((SOURCE / 'UPSTREAM.json').read_bytes()).hexdigest(),
    source_hashes={name: entry['sha256'] for name, entry in manifest['files'].items()},
    native_symbols=symbols, input_output_sentinel=SENTINEL,
    evidence='ctypes.PyDLL calls actual loaded Blender functions; no Python eval/float model',
    event_state_machine_tested=False,
    event_scope='=/* first-trigger and Ctrl+V first-line require the separate unchanged v4.3 handleNumInput C event harness',
    python_cases=python_cases, bpy_cases=bpy_cases, unit_cases=unit_cases,
)
destination = ROOT / 'tests/integration/fixtures/add-camera-rigs-numinput-advanced-blender.json'
destination.write_text(json.dumps(fixture, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
print('Exported actual native cases:', len(python_cases), 'PyC,', len(bpy_cases), 'BPY,', len(unit_cases), 'scene units')
print(destination)
