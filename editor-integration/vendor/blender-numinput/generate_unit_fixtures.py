# SPDX-License-Identifier: GPL-2.0-or-later
"""Freeze original native C++ unit/Unicode results with real CPython expression evaluation."""
from pathlib import Path
import argparse
import ctypes
import json
import math
import platform

import units_build

HERE = Path(__file__).resolve().parent
DEFAULT = dict(system=0, scale_length=1, system_rotation=0, length_unit=255,
               mass_unit=255, time_unit=255, temperature_unit=255, flag=0)


def json_number(value):
    return '-0' if value == 0 and math.copysign(1, value) < 0 else value


def generate(out):
    library, prepared = units_build.build_native(out)
    native = ctypes.CDLL(str(library.resolve()))
    native.numinput_unit_text.restype = ctypes.c_void_p
    native.numinput_unit_result.restype = ctypes.c_void_p
    native.numinput_unit_settings.argtypes = [ctypes.c_int, ctypes.c_double, *[ctypes.c_int] * 6]
    native.numinput_unit_format.argtypes = [ctypes.c_double, *[ctypes.c_int] * 5]
    native.numinput_unit_preferred.argtypes = [ctypes.c_double, ctypes.c_int]
    native.numinput_unit_preferred.restype = ctypes.c_double
    native.numinput_unit_scale.restype = ctypes.c_double
    native.numinput_unit_multiplier.restype = ctypes.c_double
    namespace = dict(vars(math))

    def text(value):
        data = value.encode() if isinstance(value, str) else bytes(value)
        ctypes.memmove(native.numinput_unit_text(), data + b'\0', len(data) + 1)

    preprocess = []
    settings = [
        ('none', DEFAULT),
        ('none-scale-ignored', {**DEFAULT, 'scale_length': 0.01}),
        ('metric', {**DEFAULT, 'system': 1}),
        ('metric-scaled', {**DEFAULT, 'system': 1, 'scale_length': 0.1}),
        ('metric-centimeter', {**DEFAULT, 'system': 1, 'length_unit': 5}),
        ('imperial', {**DEFAULT, 'system': 2}),
        ('imperial-scaled', {**DEFAULT, 'system': 2, 'scale_length': 2}),
        ('imperial-inch', {**DEFAULT, 'system': 2, 'length_unit': 4}),
        ('radians', {**DEFAULT, 'system': 1, 'system_rotation': 2}),
    ]
    inputs = {
        0: ['2', '-0', '2/3', '012', '012.0', '.', '1e309', 'sqrt(9)', '1,2,3', 'True', '2m'],
        1: ['2', '-0', '2/3', 'sqrt(9)', 'sin(pi/2)', '2m', '2cm', '1m50cm', '-1m50cm',
            '--1m50cm', '-1m50cm + 1 - 2m50cm', '2+2mm', '2+2in', "5'2\"", '2ft 6in',
            '1µm', '1um', '1 micrometer', '1 METERS', '1e-3m', 'sqrt(4)m', '1m,2cm',
            '1m+2unknown', 'diameter', '1mm+2cm', '1m*2', '(1m + 2cm)/2'],
        5: ['90', '-0', 'pi', '180d', '90°', '1rad', '1r', "1'", '1asec', '2 degrees',
            'pi/2rad', '90d/2', '--90d', '1rad+90d', 'sin(pi/2)', '2+2d', '1d,2d', 'diameter'],
    }
    for setting_name, units in settings:
        native.numinput_unit_settings(*units.values())
        for kind, values in inputs.items():
            for value in values:
                text(value)
                native.numinput_unit_preprocess(kind)
                expression = ctypes.string_at(native.numinput_unit_result()).decode()
                has_unit = bool(native.numinput_unit_has_unit())
                scale = native.numinput_unit_scale()
                row = dict(name=f'{setting_name}-{kind}-{value}', text=value, type=kind, units=units,
                           expression=expression, hasUnit=has_unit, unitScale=scale,
                           multiplier=native.numinput_unit_multiplier(kind))
                try:
                    result = eval(expression, namespace)
                    if isinstance(result, tuple):
                        evaluated = 0.0
                        for item in result:
                            evaluated += float(item)
                    else:
                        evaluated = float(result)
                    if not math.isfinite(evaluated):
                        evaluated = 0.0
                    preferred = native.numinput_unit_preferred(evaluated, kind)
                    final = evaluated if has_unit else preferred / scale
                    row['evaluation'] = dict(success=True, value=json_number(evaluated))
                    row['preferredValue'] = json_number(preferred)
                    row['value'] = json_number(final)
                except (SyntaxError, ValueError, TypeError, NameError, OverflowError, ZeroDivisionError) as error:
                    row['evaluation'] = dict(success=False, error=type(error).__name__)
                preprocess.append(row)

    formats = []
    for system in [0, 1, 2]:
        for kind in [0, 1, 5]:
            for value in [0.0, -0.0, 1e-9, 0.001, 0.0254, 0.5, 1.8288, -1.8288, math.pi / 2,
                          100000.5, 100001.5, 1e9]:
                for precision, split, pad in [(6, True, False), (6, False, False),
                                               (3, True, True), (-6, False, False)]:
                    length = native.numinput_unit_format(value, precision, system, kind, split, pad)
                    formats.append(dict(value=json_number(value), precision=precision, system=system,
                                        type=kind, split=split, pad=pad,
                                        result=ctypes.string_at(native.numinput_unit_result()).decode(),
                                        length=length))

    cursors, sizes = [], []
    for value in ['12.34 + 56', '1m50cm', '90°/2', 'a\u0301b', 'x\u200by', '中文（12）',
                  'µm + 日本語', 'a\u200d😀b', 'a\u1160b', 'a\ufe0fb', 'a\ue000b']:
        text(value)
        offsets, offset = [0], 0
        for character in value:
            sizes.append(dict(text=value, byteOffset=offset, size=len(character.encode())))
            offset += len(character.encode())
            offsets.append(offset)
        for offset in offsets:
            for direction in [0, 1]:
                for jump in [0, 1, 2]:
                    for use_init in ([True, False] if jump == 1 else [True]):
                        result = native.numinput_unit_cursor_step(offset, direction, jump, use_init)
                        cursors.append(dict(text=value, byteOffset=offset, direction=direction,
                                            jump=jump, useInitStep=use_init, result=result))
    invalid = []
    for data in [[49, 255, 50], [97, 195, 40, 98], [240, 159, 152],
                 [97, 0, 98], [194, 176], [192, 128, 49], [237, 160, 128, 49]]:
        text(data)
        native.numinput_unit_strip_invalid(len(data))
        invalid.append(dict(bytes=data, result=ctypes.string_at(native.numinput_unit_text()).decode()))
    return dict(schemaVersion=1, ref='v4.3.0', sources=prepared['hashes'],
                evaluator=dict(implementation='CPython', version=platform.python_version(),
                               namespace='math module globals and CPython builtins; tuple accumulation and nonfinite-to-zero follow PyC_RunString_AsNumber'),
                preprocessCases=preprocess, formatCases=formats, cursorCases=cursors,
                charSizeCases=sizes, invalidUtf8Cases=invalid)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = generate(units_build.ROOT / '.integration-audit/numinput-units')
    text = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    target = HERE / 'unit-fixtures.json'
    if args.check:
        assert target.read_text() == text, 'Native unit fixture changed'
    else:
        target.write_text(text)
    print(', '.join(f'{name}: {len(result[name])}' for name in
                    ['preprocessCases', 'formatCases', 'cursorCases', 'charSizeCases', 'invalidUtf8Cases']))
