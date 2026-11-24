#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Compile original Blender NumInput/units/Unicode and original PyC functions with CPython."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import sysconfig
import tempfile

import generate_fixtures
import units_build

HERE = Path(__file__).resolve().parent
STATE_SOURCE = HERE / 'advanced-state-sources'


def read(name):
    data = (STATE_SOURCE / name).read_bytes()
    record = json.loads((STATE_SOURCE / 'UPSTREAM.json').read_text())['files'][name]
    assert hashlib.sha256(data).hexdigest() == record['sha256'], name
    return data.decode()


def python_translation_unit():
    original = read('py_capi_utils.cc')
    names = ['PyC_UnicodeFromBytesAndSize', 'PyC_UnicodeFromBytes', 'PyC_DefaultNameSpace',
             'PyC_NameSpace_ImportArray', 'PyC_MainModule_Backup', 'PyC_MainModule_Restore',
             'pyc_run_string_as_py_object', 'PyC_RunString_AsNumber']
    return '''#include "advanced-boundaries.hh"
#include <Python.h>
#if PY_VERSION_HEX < 0x030A0000
static int PyModule_AddObjectRef(PyObject *module, const char *name, PyObject *value)
{
  return PyDict_SetItemString(PyModule_GetDict(module), name, value);
}
#endif
''' + '\n\n'.join(units_build.function(original, name) for name in names) + '\n'


def clipboard_translation_unit():
    original = read('wm_window.cc')
    return '#include "advanced-boundaries.hh"\n' + '\n\n'.join(
        units_build.function(original, name)
        for name in ['wm_clipboard_text_get_ex', 'WM_clipboard_text_get_firstline']) + '\n'


def python_flags():
    include = Path(sysconfig.get_config_var('INCLUDEPY'))
    framework = sysconfig.get_config_var('PYTHONFRAMEWORK')
    prefix = Path(sysconfig.get_config_var('PYTHONFRAMEWORKPREFIX') or '')
    if framework:
        if not include.exists():
            prefix = Path(sys.executable).parents[2] / 'Library/Frameworks'
            include = prefix / (framework + '.framework/Versions/' + sysconfig.get_python_version()) / 'Headers'
        assert (include / 'Python.h').exists(), include
        return ['-I', str(include), '-F', str(prefix), '-framework', framework,
                '-Wl,-rpath,' + str(prefix)]
    library = sysconfig.get_config_var('LDLIBRARY')
    name = library.removeprefix('lib').split('.so')[0].split('.dylib')[0]
    directory = sysconfig.get_config_var('LIBDIR')
    return ['-I', str(include), '-L', directory, '-l' + name,
            '-Wl,-rpath,' + directory]


def run(cases):
    with tempfile.TemporaryDirectory(prefix='blender-numinput-advanced-') as directory:
        build = Path(directory)
        includes = build / 'include'
        includes.mkdir()
        for header in generate_fixtures.HEADERS:
            (includes / header).write_text('#include "advanced-boundaries.hh"\n')
        python_source = build / 'python-native.cc'
        python_source.write_text(python_translation_unit())
        clipboard_source = build / 'clipboard-native.cc'
        clipboard_source.write_text(clipboard_translation_unit())
        numinput_object = build / 'numinput.o'
        subprocess.run(['clang++', *units_build.FLAGS, '-DWITH_PYTHON',
                        '-I', str(includes), '-I', str(HERE), '-c',
                        str(HERE / 'numinput.cc'), '-o', str(numinput_object)], check=True)
        executable, prepared = units_build.build_native(
            build, build / 'advanced-oracle',
            extra_sources=[numinput_object, HERE / 'advanced-oracle.cc',
                           python_source, clipboard_source],
            extra_flags=['-DWITH_PYTHON', '-I', str(includes), *python_flags()])
        operations = []
        for case in cases:
            mode = case['kind']
            units = dict(system=0, scale_length=1, system_rotation=0, length_unit=255)
            units.update(case.get('units', {}))
            initial = case.get('initialValues', [1, 1, 1] if mode == 'scale' else [0, 0, 0])
            maximum = case.get('idxMax', 0 if mode == 'rotate' else 2)
            operations.append('INIT %s %d %d %d %s %d %d %s' % (
                mode, maximum, case.get('advancedPreferred', False), units['system'],
                units['scale_length'], units['system_rotation'], units['length_unit'],
                ' '.join(map(str, initial))))
            for event in case['events']:
                key = event['key']
                text = event.get('text', key if len(key) == 1 else '')
                event_type = generate_fixtures.CODE_TYPES.get(
                    event.get('code'), generate_fixtures.TYPES.get(key, 17))
                if event.get('code') == 'KeyC': event_type = 15
                if event.get('code') == 'KeyV': event_type = 16
                if 'modalValue' in event: event_type = 1
                modifiers = (1 if event.get('ctrlKey') else 0) | (2 if event.get('altKey') else 0) | (4 if event.get('shiftKey') else 0)
                clipboard = event.get('clipboardText')
                clip_hex = 'NULL' if clipboard is None else clipboard.encode().hex() or '-'
                operations.append('EVENT %d %d %d %s %s' % (
                    event_type, modifiers, event.get('modalValue', 0), text.encode().hex() or '-', clip_hex))
        native = subprocess.run([str(executable)], input='\n'.join(operations) + '\n',
                                text=True, stdout=subprocess.PIPE, check=True)
        states = iter(json.loads(line) for line in native.stdout.splitlines())
        output = []
        for case in cases:
            result = dict(case, initial=next(states))
            result['events'] = [dict(event=event, **next(states)) for event in case['events']]
            output.append(result)
        hashes = {str(path.relative_to(units_build.ROOT)): units_build.digest(path)
                  for path in [HERE / 'numinput.cc', HERE / 'ED_numinput.hh',
                               HERE / 'advanced-boundaries.hh', HERE / 'advanced-oracle.cc',
                               Path(__file__), *[STATE_SOURCE / name for name in
                                                ['py_capi_utils.cc', 'wm_window.cc', 'transform_snap.cc']]]}
        hashes.update(prepared['hashes'])
        return dict(schemaVersion=1, ref='v4.3.0', sources=hashes,
                    oracle='Original NumInput, units, Unicode cursor, clipboard first-line and PyC number functions compiled with real CPython; only context, GHOST contents, reporting and host C-API compatibility are adapted.',
                    cpython=sysconfig.get_python_version(), scenarios=output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    arguments = parser.parse_args()
    cases = json.loads((HERE / 'advanced-cases.json').read_text())['scenarios']
    result = run(cases)
    content = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    fixture = HERE / 'advanced-fixtures.json'
    if arguments.check:
        assert fixture.read_text() == content, 'Advanced native state fixture changed'
    else:
        fixture.write_text(content)
    print('Advanced native oracle: %d scenarios, %d event snapshots; original CPython functions on %s.' % (
        len(cases), sum(len(case['events']) for case in cases), result['cpython']))


if __name__ == '__main__':
    main()
