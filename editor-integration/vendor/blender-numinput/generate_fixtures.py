#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Compile unchanged upstream NumInput/cursor bodies and freeze their state traces."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
HEADERS = [
    "MEM_guardedalloc.h", "BLI_math_rotation.h", "BLI_math_vector.h", "BLI_string.h",
    "BLI_string_cursor_utf8.h", "BLI_string_utf8.h", "BLI_utildefines.h", "BLI_strict_flags.h",
    "BLT_translation.hh", "BKE_context.hh", "BKE_report.hh", "BKE_scene.hh", "BKE_unit.hh",
    "DNA_scene_types.h", "WM_api.hh", "WM_types.hh", "BPY_extern_run.hh", "UI_interface.hh",
]
TYPES = {
    "Backspace": 2, "Delete": 3, "ArrowLeft": 4, "ArrowRight": 5, "Home": 6,
    "End": 7, "Tab": 8, ".": 10, "-": 12, "/": 14, "c": 15, "v": 16,
}
CODE_TYPES = {"NumpadDecimal": 9, "NumpadSubtract": 11, "NumpadDivide": 13,
              "Period": 10, "Minus": 12, "Slash": 14}
SOURCE_FILES = ("numinput.cc", "ED_numinput.hh", "string_cursor_utf8.c", "unit.cc",
                "../blender-fcurve/math_base_inline.c")


def formatter_cases():
    values = [
        "-0", 0, 1, -1, 0.5, -0.5, 1.015625, 1.234375, 100000.5, 100001.5,
        -100000.5, -100001.5, 0.00000049, 0.0000005, 0.00000051,
        0.999999, 0.9999995, 1.000001, 9.99999, 9.999995, 10.00001,
        99.9999, 99.99995, 100.0001, 99999.9, 999999.5, 1234567.25,
        struct.unpack("<f", struct.pack("<I", 0x7f7fffff))[0],
        struct.unpack("<f", struct.pack("<I", 0xff7fffff))[0],
        struct.unpack("<f", struct.pack("<I", 1))[0],
        struct.unpack("<f", struct.pack("<I", 0x80000001))[0],
        3.141592653589793 / 180, 3.141592653589793 / 2, 3.141592653589793,
    ]
    values.extend(sign * 10.0 ** exponent for exponent in range(-9, 10) for sign in (1, -1))
    cases = [dict(name="fixed-%d-%s" % (index, "degree" if rotation else "dummy"),
                  value=value, rotation=rotation, precision=6)
             for index, value in enumerate(values) for rotation in (False, True)]
    rng = random.Random(0x4300)
    for index in range(128):
        bits = rng.getrandbits(32)
        while (bits & 0x7f800000) == 0x7f800000:
            bits = rng.getrandbits(32)
        value = struct.unpack("<f", struct.pack("<I", bits))[0]
        for rotation in (False, True):
            cases.append(dict(name="f32-%08x-%s" % (bits, "degree" if rotation else "dummy"),
                              value=value, rotation=rotation, precision=6))
    return cases


def formatter_translation_unit():
    math_source = (ROOT / "../blender-fcurve/math_base_inline.c").read_text()
    start = math_source.index("MINLINE int integer_digits_d(")
    end = math_source.index("MINLINE int integer_digits_i(", start)
    unit_source = (ROOT / "unit.cc").read_text()
    regions = []
    for first, following in (
        ("struct bUnitDef {", "/* Lengths. */"),
        ("static bUnitDef buNaturalRotDef[] = {", "/* Camera Lengths. */"),
        ("static const bUnitDef *unit_default(", "static bool unit_should_be_split("),
    ):
        beginning = unit_source.index(first)
        finish = unit_source.index(following, beginning)
        regions.append(unit_source[beginning:finish])
    epsilon = next(line for line in unit_source.splitlines() if line.startswith("#define EPS "))
    return '''#include "native-boundaries.hh"
''' + epsilon + '\n' + math_source[start:end] + '\n' + '\n'.join(regions) + '''
size_t BKE_unit_value_as_string_adaptive(char *str, int length, double value, int precision,
                                         int, int type, bool, bool pad)
{
  const bUnitCollection *collection = type == B_UNIT_ROTATION ? &buNaturalRotCollection : &buDummyCollection;
  const bUnitDef *unit = type == B_UNIT_ROTATION ? &buNaturalRotDef[0] : nullptr;
  return unit_as_string(str, length, value, precision, collection, unit, pad ? ' ' : '\\0');
}
'''


def run_oracle(scenarios):
    with tempfile.TemporaryDirectory(prefix="blender-numinput-") as directory:
        build = Path(directory)
        include = build / "include"
        include.mkdir()
        for header in HEADERS:
            (include / header).write_text('#include "native-boundaries.hh"\n')
        executable = build / "numinput-oracle"
        formatter_source = build / "unit-format-native.cc"
        formatter_source.write_text(formatter_translation_unit())
        command = [os.environ.get("CXX", "clang++"), "-std=c++17", "-O0", "-DWITH_PYTHON",
                   "-I", str(include), "-I", str(ROOT), "-x", "c++",
                   str(ROOT / "numinput.cc"), str(ROOT / "string_cursor_utf8.c"),
                   str(ROOT / "native-oracle.cc"), str(formatter_source), "-o", str(executable)]
        subprocess.run(command, check=True)
        operations = []
        for case in scenarios:
            kind = case["kind"]
            values = case.get("initialValues", [1, 1, 1] if kind == "scale" else [0, 0, 0])
            if len(values) != 3:
                raise ValueError("initialValues must contain exactly three numbers")
            maximum = case.get("idxMax", 0 if kind == "rotate" else 2)
            if kind not in ("translate", "rotate", "scale") or not 0 <= maximum < 3:
                raise ValueError("Unsupported kind or idxMax")
            affect_all = case.get("affectAll", kind == "scale")
            null_one = case.get("nullOne", kind == "scale")
            operations.append("INIT %s %d %d %d %s" % (
                kind, maximum, affect_all, null_one, " ".join(map(str, values))))
            for event in case["events"]:
                key = event["key"]
                code = event.get("code")
                event_type = CODE_TYPES.get(code, TYPES.get(key, 17))
                modifiers = (1 if event.get("ctrlKey") else 0) | (4 if event.get("shiftKey") else 0)
                text = key if len(key) == 1 else ""
                operations.append("EVENT %d %d %s" % (
                    event_type, modifiers, text.encode().hex() or "-"))
        format_inputs = formatter_cases()
        for case in format_inputs:
            operations.append("FORMAT %s %d %d" % (case["value"], case["rotation"], case["precision"]))
        native = subprocess.run([str(executable)], input="\n".join(operations) + "\n",
                                text=True, stdout=subprocess.PIPE, check=True)
        states = iter(json.loads(line) for line in native.stdout.splitlines())
        output = []
        for case in scenarios:
            case_output = dict(case)
            case_output["initial"] = next(states)
            case_output["events"] = [dict(event=event, **next(states)) for event in case["events"]]
            output.append(case_output)
        sources = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCE_FILES}
        numeric_fixture = {
            "schemaVersion": 1,
            "ref": "v4.3.0",
            "mode": "default simple numeric input (USER_FLAG_NUMINPUT_ADVANCED disabled)",
            "sources": sources,
            "boundaryModel": {
                "native": "Original initNumInput, hasNumInput, applyNumInput, handleNumInput, cursor, unit_default/unit_best_fit/unit_as_string and integer_digits_d bodies",
                "mocked": "Context/unit parsing/Python/report/clipboard/string helpers at API boundaries",
                "units": "Unitless translate/scale; rotate input degrees and stored float radians",
                "formatter": "Original unit_as_string executes against original dummy or preferred degree collection; adaptive API wrapper selects only the default context",
                "evaluation": "Strict Python-compatible simple decimal tokens with surrounding whitespace; optional trailing degree sign is converted to radians",
                "cursor": "Original cursor C compiled as C++; low-level UTF-8 helpers support corpus ASCII and spacing degree sign",
                "apply": "Each candidate vector starts from scenario initialValues before applyNumInput",
                "excluded": "Advanced expression mode, metric/imperial conversion, clipboard contents, combining marks",
            },
            "scenarios": output,
        }
        format_fixture = {
            "schemaVersion": 1,
            "ref": "v4.3.0",
            "sources": sources,
            "precision": 6,
            "oracle": "Direct original unit_as_string with original dummy/default degree collections; integer_digits_d original body; C snprintf at the string API boundary",
            "random": "128 finite float32 raw-bit values from Python Random(0x4300), each as dummy and degree",
            "cases": [dict(case, **next(states)) for case in format_inputs],
        }
        return numeric_fixture, format_fixture


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "fixture-cases.json")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--format-output", type=Path)
    parser.add_argument("--check", action="store_true", help="Compare regenerated default fixtures to frozen JSON")
    options = parser.parse_args()
    inputs = json.loads(options.input.read_text())
    scenarios = inputs["scenarios"] if isinstance(inputs, dict) else inputs
    fixture, format_fixture = run_oracle(scenarios)
    content = json.dumps(fixture, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    format_content = json.dumps(format_fixture, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if options.check:
        frozen = ROOT / "fixtures.json"
        if frozen.read_text() != content:
            raise SystemExit("Native oracle differs from frozen fixtures.json; regenerate and review.")
        if (ROOT / "format-fixtures.json").read_text() != format_content:
            raise SystemExit("Native formatter differs from frozen format-fixtures.json; regenerate and review.")
        print("Native oracle reproduces %d scenarios, %d event snapshots and %d formatter cases." % (
            len(scenarios), sum(len(case["events"]) for case in scenarios), len(format_fixture["cases"])))
    elif options.output:
        options.output.write_text(content)
    else:
        print(content, end="")
    if options.format_output:
        options.format_output.write_text(format_content)


if __name__ == "__main__":
    main()
