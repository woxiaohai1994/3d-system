# SPDX-License-Identifier: GPL-2.0-or-later
"""Compile Blender's unchanged unit and Unicode functions for WASM and native oracles."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'advanced-sources'
SDK = ROOT / '.integration-audit/toolchains/wasi-sdk-34.0-arm64-macos'
FLAGS = ['-std=c++17', '-O2', '-DNDEBUG', '-funsigned-char', '-ffp-contract=off',
         '-fno-strict-aliasing', '-fno-exceptions', '-fno-rtti']
EXPORTS = ['numinput_unit_text', 'numinput_unit_result', 'numinput_unit_capacity',
           'numinput_unit_settings', 'numinput_unit_preprocess', 'numinput_unit_has_unit',
           'numinput_unit_scale', 'numinput_unit_multiplier', 'numinput_unit_preferred',
           'numinput_unit_format', 'numinput_unit_cursor_step', 'numinput_unit_strip_invalid',
           'numinput_unit_char_size', 'numinput_unit_ui_is_unit', 'numinput_unit_ui_step',
           'numinput_unit_ui_base_scalar', 'numinput_unit_ui_valid', 'numinput_unit_ui_format', 'numinput_unit_ui_edit_format']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def function(text, name):
    masked = re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', lambda m: ' ' * len(m[0]), text)
    match = re.search(r'^[\w *]+\b' + name + r'\([^;{}]*\)\s*\{', masked, re.M)
    assert match, name
    end, depth = match.end(), 1
    while depth:
        depth += (masked[end] == '{') - (masked[end] == '}')
        end += 1
    return text[match.start():end].strip()


def read(name):
    path = SOURCE / name
    manifest = json.loads((SOURCE / 'UPSTREAM.json').read_text())
    assert digest(path) == manifest['files'][name]['sha256'], name
    return path.read_text()


def header_text():
    dna = read('DNA_scene_types.h')
    layout = re.search(r'typedef struct UnitSettings \{[\s\S]*?\} UnitSettings;', dna)[0]
    settings = dna[dna.index('#define USER_UNIT_ADAPTIVE'):dna.index('/** #SceneEEVEE::flag */')]
    bke = read('BKE_unit.hh')
    declarations = bke[bke.index('struct UnitSettings;'):]
    utf8 = read('BLI_string_utf8.h')
    utf8 = utf8[utf8.index('#ifdef __cplusplus'):]
    utf8 = re.sub(r'ATTR_(?:NONNULL|WARN_UNUSED_RESULT|RETURNS_NONNULL)(?:\([^)]*\))?', '', utf8)
    return '\n'.join(['/* SPDX-License-Identifier: GPL-2.0-or-later */', '#pragma once',
                      '#include <cstddef>', '#include "advanced-sources/BLI_sys_types.h"',
                      layout, settings, declarations, utf8,
                      '#include "advanced-sources/BLI_string_cursor_utf8.h"',
                      'double BKE_scene_unit_scale(const UnitSettings *, int, double);']) + '\n'


def prepare(out):
    """Return native translation units, include path, flags and source hashes for callers."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    header = HERE / 'unit-native-boundaries.hh'
    assert header.read_text() == header_text(), 'Rebuild generated UnitSettings/prototypes header'
    text = (HERE / 'unit.cc').read_text()
    unit_manifest = json.loads((HERE / 'UPSTREAM.json').read_text())
    assert digest(HERE / 'unit.cc') == unit_manifest['files']['unit.cc']['sha256']
    body = text[text.index('#define TEMP_STR_SIZE'):]
    base = (ROOT / 'vendor/blender-fcurve/math_base_inline.c').read_text()
    math = '\n\n'.join(function(base, name) for name in ['max_ii', 'integer_digits_d'])
    unit_cpp = out / 'units-native.cc'
    unit_cpp.write_text('#include "unit-adapter-prefix.hh"\n' + math + '\n' + body + '\n' +
                        function(read('scene.cc'), 'BKE_scene_unit_scale') + '\n')
    string = read('string.c')
    functions = ['BLI_strnlen', 'BLI_strncpy', 'BLI_strncpy_rlen', 'BLI_vsnprintf',
                 'BLI_vsnprintf_rlen', 'BLI_snprintf', 'BLI_snprintf_rlen',
                 'BLI_strncasecmp', 'BLI_strcasestr', 'BLI_str_rstrip_float_zero']
    string_cpp = out / 'strings-native.cc'
    string_cpp.write_text('#include "unit-adapter-prefix.hh"\n' +
                          '\n\n'.join(function(string, name) for name in functions) + '\n')
    utf8 = read('string_utf8.cc')
    functions = ['utf8_char_compute_skip', 'utf8_char_compute_skip_or_error',
                 'utf8_char_compute_skip_or_error_with_mask', 'utf8_char_decode',
                 'BLI_str_utf8_invalid_byte', 'BLI_str_utf8_invalid_strip',
                 'BLI_wcwidth_or_error', 'BLI_str_utf8_char_width_or_error',
                 'BLI_str_utf8_size_or_error', 'BLI_str_utf8_as_unicode_or_error',
                 'BLI_str_utf8_as_unicode_step_or_error', 'BLI_str_find_prev_char_utf8',
                 'BLI_str_find_next_char_utf8']
    cursor = (HERE / 'string_cursor_utf8.c').read_text()
    cursor = cursor[cursor.index('/**\n * The category'):]
    unicode_cpp = out / 'unicode-native.cc'
    unicode_cpp.write_text('#include "unit-adapter-prefix.hh"\n' +
                           '#include "advanced-sources/wcwidth.h"\n' +
                           read('wcwidth.c') + '\n' +
                           '\n\n'.join(function(utf8, name) for name in functions) + '\n' + cursor)
    ui_folder = ROOT / 'vendor/blender-property-decorators'
    ui_manifest = json.loads((ui_folder / 'UPSTREAM.json').read_text())
    ui_paths = [ui_folder / name for name in ['interface.cc', 'UI_interface_c.hh', 'RNA_types.hh']]
    for path in ui_paths:
        assert digest(path) == ui_manifest['files'][path.name]['sha256'], path.name
    interface = ui_paths[0].read_text()
    rna = ui_paths[2].read_text()
    enums = '\n'.join(re.search(r'enum ' + name + r' \{[\s\S]*?\};', rna)[0]
                       for name in ['PropertyUnit', 'PropertySubType'])
    defines = '\n'.join(re.search(r'^#define ' + name + r'(?:\([^)]*\))? [^\n]+',
                         rna if name.startswith('RNA_') else ui_paths[1].read_text(), re.M)[0]
                        for name in ['RNA_SUBTYPE_UNIT_VALUE', 'UI_PRECISION_FLOAT_SCALE', 'UI_PRECISION_FLOAT_MAX', 'UI_MAX_DRAW_STR'])
    (out / 'property-number-source.hh').write_text(enums + '\n' + defines + '\n')
    (out / 'property-number-functions.hh').write_text('\n\n'.join(
        function(interface, name) for name in ['ui_but_is_unit_radians_ex', 'ui_but_is_unit',
        'ui_get_but_scale_unit', 'ui_get_but_string_unit', 'ui_get_but_step_unit', 'ui_but_hide_fraction']) + '\n' +
        function(base, 'integer_digits_f') + '\n')
    numeric = function(interface, 'ui_but_string_get_ex')
    numeric_body = numeric[numeric.index('    /* number editing */'):numeric.rfind('\n  }')]
    (out / 'property-number-edit-functions.hh').write_text(
        'static void property_number_edit_string_get(uiBut *but, char *str, size_t str_maxncpy, '
        'int float_precision, bool use_exp_float, bool *r_use_exp_float) {\n' + numeric_body + '\n}\n')
    hashes = {str(path.relative_to(ROOT)): digest(path) for path in
              [HERE / 'unit.cc', HERE / 'string_cursor_utf8.c', header,
               HERE / 'unit-adapter-prefix.hh', HERE / 'unit-adapter-api.cc',
               HERE / 'unit-wasi-libc-boundaries.cc', HERE / 'units_build.py',
               ROOT / 'vendor/blender-fcurve/math_base_inline.c',
               HERE / 'property-number-unit-api.cc', *ui_paths,
               *[SOURCE / name for name in json.loads((SOURCE / 'UPSTREAM.json').read_text())['files']]]}
    return dict(sources=[unit_cpp, string_cpp, unicode_cpp, HERE / 'unit-adapter-api.cc', HERE / 'property-number-unit-api.cc'],
                include=HERE, flags=FLAGS, hashes=hashes, header=header)


def build_native(out, target=None, extra_sources=(), extra_flags=()):
    prepared = prepare(out)
    target = Path(target) if target else Path(out) / 'units-native.dylib'
    command = ['clang++', *FLAGS, '-I', str(HERE), '-I', str(SOURCE), '-I', str(out)]
    if not extra_sources:
        command += ['-shared', '-fPIC']
    subprocess.run(command + [str(p) for p in prepared['sources']] +
                   [str(p) for p in extra_sources] + list(extra_flags) + ['-o', str(target)], check=True)
    return target, prepared


def build_wasm(out, sdk=SDK):
    prepared = prepare(out)
    wasm = Path(out) / 'units.wasm'
    command = [str(Path(sdk) / 'bin/clang++'), '--target=wasm32-wasip1', *FLAGS,
               '-I', str(HERE), '-I', str(SOURCE), '-I', str(out), '-nostartfiles', '-Wl,--no-entry',
               '-Wl,--strip-all', *['-Wl,--export=' + name for name in EXPORTS],
               *['-Wl,--wrap=__wasi_' + name for name in
                 ['clock_time_get', 'fd_close', 'fd_seek', 'fd_write']]]
    subprocess.run(command + [str(p) for p in prepared['sources']] +
                   [str(HERE / 'unit-wasi-libc-boundaries.cc'), '-o', str(wasm)], check=True)
    return dict(hashes=prepared['hashes'], wasm=base64.b64encode(wasm.read_bytes()).decode(),
                wasmHash=digest(wasm))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--sdk', type=Path, default=SDK)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    out = ROOT / '.integration-audit/numinput-units'
    result = build_wasm(out, args.sdk)
    target = ROOT / 'packages/editor/src/components/scene-camera/rig-numinput-units-source.json'
    saved = json.dumps(result, separators=(',', ':')) + '\n'
    if args.check:
        assert target.read_text() == saved, 'WASM unit artifact changed'
    else:
        target.write_text(saved)
    native, _ = build_native(out)
    print(f'Original Blender units/Unicode: {len(base64.b64decode(result["wasm"]))} WASM bytes; native {native}')
