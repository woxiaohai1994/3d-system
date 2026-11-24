#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Freeze original Blender UI text, unit step/format and unit-connected NUM traces."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'vendor/blender-numinput'
sys.path.insert(0, str(HERE))
import generate_advanced_fixtures
import units_build

TARGET = HERE / 'property-number-text-fixtures.json'
SUBTYPES = {'NONE': (0, 0), 'FACTOR': (15, 0), 'PERCENTAGE': (14, 0),
            'ANGLE': (16 | (5 << 16), 5), 'DISTANCE': (18 | (1 << 16), 1),
            'DISTANCE_CAMERA': (19 | (10 << 16), 10), 'EULER': (26 | (5 << 16), 5)}
DEFAULT_UNITS = dict(system=0, scale_length=1, system_rotation=0, flag=0,
                     length_unit=255, mass_unit=255, time_unit=255, temperature_unit=255)


def read_vendor(folder, name, hashes):
    path = ROOT / 'vendor' / folder / name
    record = json.loads((path.parent / 'UPSTREAM.json').read_text())['files'][name]
    assert units_build.digest(path) == record['sha256'], str(path)
    hashes[str(path.relative_to(ROOT))] = record['sha256']
    return path.read_text()


def number_translation_unit(hashes):
    handlers, interface, header = (read_vendor('blender-property-decorators', name, hashes)
                                    for name in ['interface_handlers.cc', 'interface.cc', 'UI_interface_c.hh'])
    prefix = ROOT / 'scripts/blender/number-adapter-prefix.hh'
    api = ROOT / 'scripts/blender/number-adapter-api.cc'
    parts = [prefix.read_text()]
    base = read_vendor('blender-fcurve', 'math_base_inline.c', hashes)
    for macro, name in [('_round_clamp_fl_impl', 'round_fl_to_int_clamp'),
                        ('_round_fl_impl', 'round_fl_to_int')]:
        parts.append(re.search(r'#define ' + macro + r'\(arg, ty(?:, min, max)?\)[\s\S]*?(?=\n#define)', base)[0])
        parts.append('static ' + re.search(r'int ' + name + r'\(float a\)\{[^}]+\}', base)[0])
    for text, name in [(handlers, 'BUTTON_DRAGLOCK_THRESH'), (handlers, 'UI_PROP_SCALE_LOG_MIN'),
                       (handlers, 'UI_PROP_SCALE_LOG_SNAP_OFFSET'),
                       (handlers, 'UI_DRAG_MAP_SOFT_RANGE_PIXEL_MAX'), (header, 'UI_PRECISION_FLOAT_SCALE')]:
        parts.append(re.search(r'^#define ' + name + r' [^\n]+', text, re.M)[0])
    parts.append(re.search(r'enum eSnapType \{[^}]+\};', handlers)[0])
    names = ['ui_but_scale_type', 'soft_range_round_up', 'soft_range_round_down', 'ui_but_range_set_soft']
    parts += [units_build.function(interface, name) for name in names]
    names = ['ui_event_to_snap', 'ui_but_dragedit_update_mval', 'ui_numedit_begin_set_values',
             'ui_numedit_begin', 'ui_numedit_apply_snapf', 'ui_numedit_apply_snap', 'ui_numedit_but_NUM',
             'ui_mouse_scale_warp_factor', 'ui_mouse_scale_warp', 'ui_numedit_but_SLI',
             'ui_event_is_snap', 'ui_numedit_set_active', 'ui_do_but_NUM', 'ui_do_but_SLI']
    parts += [units_build.function(handlers, name) for name in names]
    widgets = read_vendor('blender-property-decorators', 'interface_widgets.cc', hashes)
    for name in ['g_shape_preset_number_arrow_vert', 'g_shape_preset_number_arrow_face']:
        parts.append(re.search(r'static const (?:float|uint) ' + name + r'\[[^;]+;', widgets)[0])
    parts += [units_build.function(widgets, name) for name in
              ['shape_preset_init_trias_ex', 'shape_preset_init_number_arrows']]
    parts.append(api.read_text())
    for path in [prefix, api]:
        hashes[str(path.relative_to(ROOT))] = units_build.digest(path)
    renamed = ['UnitSettings', 'uiBlock', 'uiBut', 'PropertyRNA', 'bContext', 'PropertySubType']
    return '\n'.join('#define %s NumberNative%s' % (name, name) for name in renamed) + '\n' + '\n\n'.join(parts) + '\n'


def prepare_text_sources(build, hashes):
    interface = read_vendor('blender-property-decorators', 'interface.cc', hashes)
    userdef = read_vendor('blender-rig-picking', 'DNA_userdef_types.h', hashes)
    bpy = read_vendor('blender-numinput/property-number-text-sources', 'bpy_interface_run.cc', hashes)
    (build / 'property-text-bpy-functions.hh').write_text(
        units_build.function(bpy, 'BPY_run_string_as_number') + '\n')
    factor_enum = re.search(r'typedef enum eUserpref_FactorDisplay \{[^}]+\} eUserpref_FactorDisplay;', userdef)[0]
    original_boundary = HERE / 'advanced-boundaries.hh'
    boundary = original_boundary.read_text()
    boundary = boundary.replace('struct UserDef { int flag = 0; };',
                                'struct UserDef { int flag = 0; int factor_display_type = 0; };')
    boundary = boundary.replace('char **r_string = nullptr; };',
                                'char **r_string = nullptr; ReportList *reports = nullptr; '
                                'const char *report_prefix = nullptr; };')
    # Distinct host type names prevent accidental linkage with the other independent UI adapters.
    aliases = ['bContext', 'Scene', 'ReportList', 'UserDef', 'Global', 'BPy_RunErrInfo', 'wmEvent', 'U', 'G']
    boundary = '\n'.join('#define %s PropertyText%s' % (name, name) for name in aliases) + '\n' + boundary
    (build / 'advanced-boundaries.hh').write_text(boundary)
    host = '''#pragma once
#include "advanced-boundaries.hh"
#include "property-number-source.hh"
struct PropertyTextBlock { const UnitSettings *unit; void *evil_C = nullptr; };
using uiBlock = PropertyTextBlock;
struct PropertyTextRNA { PropertySubType subtype; };
struct PropertyTextButton {
  uiBlock *block;
  int unit_type, precision;
  PropertyTextRNA *rnaprop;
  bool is_float;
  float hardmin, hardmax;
  double softmin, softmax, value;
};
using uiBut = PropertyTextButton;
static int UI_but_unit_type_get(const uiBut *but) { return but->unit_type << 16; }
static bool ui_but_is_float(const uiBut *but) { return but->is_float; }
static PropertySubType RNA_property_subtype(const PropertyTextRNA *prop) { return prop->subtype; }
static void ui_but_value_set(uiBut *but, double value) { but->value = value; }
static void *CTX_wm_manager(bContext *) { return nullptr; }
static void *CTX_wm_window(bContext *) { return nullptr; }
static void WM_report_banner_show(void *, void *) {}
void BKE_reportf(ReportList *, int, const char *, ...);
bool user_string_to_number(bContext *, const char *, const UnitSettings *, int, double *, bool, char **);
static_assert(PROP_NONE == 0 && PROP_FACTOR == 15 && PROP_PERCENTAGE == 14);
static_assert(PROP_ANGLE == (16 | (5 << 16)) && PROP_EULER == (26 | (5 << 16)));
static_assert(PROP_DISTANCE == (18 | (1 << 16)) && PROP_DISTANCE_CAMERA == (19 | (10 << 16)));
'''
    (build / 'property-text-boundaries.hh').write_text(host + factor_enum + '\n')
    string = units_build.read('string.c')
    strdupn = units_build.function(string, 'BLI_strdupn')
    # MEM_mallocN is void* in the host boundary; C's implicit allocation conversion needs a C++ cast.
    assert 'char *n = MEM_mallocN(len + 1, "strdup");' in strdupn
    strdupn = strdupn.replace('char *n = MEM_mallocN(len + 1, "strdup");',
                            'char *n = static_cast<char *>(MEM_mallocN(len + 1, "strdup"));')
    names = ['ui_but_is_unit_radians_ex', 'ui_but_is_unit', 'ui_number_from_string_units',
             'ui_number_from_string_units_with_but', 'ui_number_from_string',
             'ui_number_from_string_factor', 'ui_number_from_string_percentage', 'ui_but_string_eval_number']
    parts = [strdupn, units_build.function(string, 'BLI_strn_endswith'),
             re.search(r'^#define UI_NUMBER_EVAL_ERROR_PREFIX [^\n]+', interface, re.M)[0],
             *[units_build.function(interface, name) for name in names]]
    whole_set = units_build.function(interface, 'ui_but_string_set')
    start = whole_set.index('    /* number editing */')
    end = whole_set.index('\n  }\n\n  return false;', start)
    numeric_branch = whole_set[start:end]
    parts.append('static bool property_text_set_number(bContext *C, uiBut *but, const char *str)\n{\n' +
                 numeric_branch + '\n}\n')
    (build / 'property-text-functions.hh').write_text('\n\n'.join(parts) + '\n')
    user_number = build / 'user-number-native.cc'
    numinput = read_vendor('blender-numinput', 'numinput.cc', hashes)
    user_number.write_text('#include "property-text-boundaries.hh"\n' +
                           units_build.function(numinput, 'user_string_to_number') + '\n')
    python_source = build / 'python-native.cc'
    python_source.write_text(generate_advanced_fixtures.python_translation_unit())
    hashes[str(original_boundary.relative_to(ROOT))] = units_build.digest(original_boundary)
    for name in ['py_capi_utils.cc']:
        read_vendor('blender-numinput/advanced-state-sources', name, hashes)
    numbers = build / 'number-native.cc'
    numbers.write_text(number_translation_unit(hashes))
    return [user_number, python_source, numbers, HERE / 'property-number-text-oracle.cc']


def units(overrides=None):
    return {**DEFAULT_UNITS, **(overrides or {})}


def text_cases():
    result = []

    def add(identifier, text, subtype='NONE', scene=None, floating=True, factor=0,
            hard=(-1000000, 1000000), soft=(-10, 10), initial=7):
        result.append(dict(id=identifier, input=text, isFloat=floating, subtype=subtype,
                           units=units(scene), factorDisplay=factor, hardMin=hard[0], hardMax=hard[1],
                           softMin=soft[0], softMax=soft[1], initial=initial))

    for identifier, expression in [
        ('empty', ''), ('whitespace', ' '), ('tab-whitespace', '\t\n'),
        ('arithmetic', '2+3'), ('arithmetic-trailing-space', '2+3 '),
        ('arithmetic-leading-space', ' 2+3'), ('sqrt', 'sqrt(9)'), ('pi', 'pi'),
        ('math-prefix', 'math.pi'), ('tuple', '2,3'), ('tuple-nested', '(2,(3,4))'),
        ('tuple-empty', '()'), ('boolean', 'True'), ('none', 'None'),
        ('list', '[2,3]'), ('invalid', 'invalid'), ('syntax', '2+'),
        ('zero-division', '2/0'), ('infinite', '1e309'), ('negative-infinite', '-1e309'),
        ('nan', 'float("nan")'), ('float-infinite', 'float("inf")'),
        ('negative-zero', '-0.0'), ('modulo', '50%3'), ('hex', '0x10'),
        ('leading-zero', '012'), ('leading-zero-float', '012.0')]:
        add(identifier, expression)
    for text in ['50%', '50% ', '50 %', ' 50%', '%', '50', '.5', '2+3%', '(20+30)%']:
        for factor in [0, 1]:
            add('factor-%s-%s' % (factor, text.encode().hex()), text, 'FACTOR', factor=factor,
                hard=(0, 100))
        add('percentage-' + text.encode().hex(), text, 'PERCENTAGE', hard=(0, 100))
    for scene_name, scene in [('none', None), ('metric', {'system': 1}),
                              ('metric-scaled', {'system': 1, 'scale_length': .01}),
                              ('imperial', {'system': 2, 'scale_length': 3})]:
        for text in ['24mm', '24', '24mm+1cm']:
            add('camera-' + scene_name + '-' + text.encode().hex(), text, 'DISTANCE_CAMERA', scene)
        for text in ['2m', '2', '2m+3cm']:
            add('distance-' + scene_name + '-' + text.encode().hex(), text, 'DISTANCE', scene)
    for subtype in ['ANGLE', 'EULER']:
        for scene_name, scene in [('degrees', None), ('radians', {'system_rotation': 2}),
                                 ('metric-scaled', {'system': 1, 'scale_length': .01})]:
            for text in ['90', '90°', 'pi', 'pi/2', '1rad']:
                add(subtype.lower() + '-' + scene_name + '-' + text.encode().hex(), text, subtype, scene)
    for text in ['-.5', '-1.5', '.5', '1.5', '-2.500001', '2.499999', '2+3', '', '50%', '1e309']:
        add('integer-' + (text.encode().hex() or 'empty'), text, floating=False)
    for floating in [False, True]:
        for text in ['25', '-25', '150', '-150', '5.5', '-5.5']:
            add('limits-%d-%s' % (floating, text.encode().hex()), text, floating=floating,
                hard=(-100, 100), soft=(-10, 10))
    add('hard-limit-float32', '0.11', hard=(-.1, .1), soft=(-.01, .01))
    add('factor-empty-does-not-divide', '', 'FACTOR', factor=1, hard=(.1, 1))
    return result


def unit_cases():
    result = []
    contexts = [('angle-none', 5, {}), ('angle-radians', 5, {'system_rotation': 2}),
                ('angle-metric-scaled', 5, {'system': 1, 'scale_length': .01}),
                ('camera-none', 10, {}), ('camera-metric', 10, {'system': 1}),
                ('camera-metric-scaled', 10, {'system': 1, 'scale_length': .01}),
                ('length-none', 1, {}), ('length-metric', 1, {'system': 1}),
                ('length-metric-scaled', 1, {'system': 1, 'scale_length': .01}),
                ('length-imperial', 1, {'system': 2}),
                ('length-metric-fixed-mm', 1, {'system': 1, 'length_unit': 6})]
    for label, unit_type, scene in contexts:
        for step in [100, 10, 1]:
            for value, precision in [(1.5707963267948966 if unit_type == 5 else .024, 3),
                                     (-.000001, 6)]:
                result.append(dict(id=f'{label}-step{step}-precision{precision}', type=unit_type,
                                   units=units(scene), stepDefault=step, value=value, precision=precision))
    return result


def snap_cases():
    result = []
    contexts = [('degrees', 5, {}), ('radians', 5, {'system_rotation': 2}),
                ('angle-metric-scaled', 5, {'system': 1, 'scale_length': .01}),
                ('camera-none', 10, {}), ('camera-metric', 10, {'system': 1, 'scale_length': .01}),
                ('length-none', 1, {}), ('length-metric', 1, {'system': 1, 'scale_length': .01})]
    moves = [[0, 1, 0, 0], [3, 1, 0, 0], [4, 1, 0, 0], [54, 1, 0, 0],
             [104, 1, 0, 0], [104, 0, 1, 0], [104, 0, 1, 1], [104, 0, 0, 1],
             [154, 1, 0, 1], [154, 0, 1, 1], [124, 1, 1, 0], [-196, 1, 1, 0]]
    events = [[0, 180, 0, 0], [2, 185, 0, 0], [2, 212, 0, 0],
              [3, 212, 1, 0], [4, 212, 1, 1], [1, 212, 1, 1]]
    cancel = [[0, 180, 0, 0], [2, 185, 0, 0], [2, 212, 0, 0], [5, 212, 0, 0]]
    for label, unit_type, scene in contexts:
        for step in [100, 10, 1]:
            for warp in [0, 1]:
                params = [.3, -1000000, 1000000, -1000, 1000, step, 6, 0, 1, warp, 0, 0, 0, 0, 0]
                result.append(dict(id=f'{label}-step{step}-warp{warp}-move', mode='move', type=unit_type,
                                   units=units(scene), params=params, events=moves))
                params = params[:]
                params[10] = 180
                for event_name, sequence in [('commit', events), ('cancel', cancel)]:
                    result.append(dict(id=f'{label}-step{step}-warp{warp}-{event_name}', mode='event',
                                       type=unit_type, units=units(scene), params=params,
                                       bounds=[100, 160, 24], events=sequence))
    return result


def edit_format_cases():
    result = []

    def add(identifier, value, subtype='NONE', scene=None, floating=True, factor=0, step=1):
        result.append(dict(id=identifier, value=value, subtype=subtype, units=units(scene),
                           isFloat=floating, factorDisplay=factor, stepDefault=step))

    for identifier, value in [('integer-valued-float', 47), ('decimal', .123456789),
                              ('small-exponent', 1e-9), ('large-exponent', 1e20),
                              ('small-fixed-boundary', 1e-6), ('smaller-exp-boundary', 1e-7),
                              ('large-fixed-boundary', 1e12), ('larger-exp-boundary', 1e13),
                              ('negative-zero', -0.0), ('tiny-negative', -.000001),
                              ('precision-edge', 999999.5)]:
        add(identifier, value)
    for factor in [0, 1]:
        for value in [0, .5, .123456789, 1]:
            add(f'factor-{factor}-{value}', value, 'FACTOR', factor=factor)
    add('percentage-50', 50, 'PERCENTAGE')
    for subtype in ['ANGLE', 'EULER']:
        for label, scene in [('degrees', None), ('radians', {'system_rotation': 2}),
                             ('metric-scaled', {'system': 1, 'scale_length': .01})]:
            add(subtype.lower() + '-' + label, 1.5707963267948966, subtype, scene, step=100)
    for subtype in ['DISTANCE', 'DISTANCE_CAMERA']:
        for label, scene in [('none', None), ('metric', {'system': 1}),
                             ('metric-scaled', {'system': 1, 'scale_length': .01}),
                             ('imperial', {'system': 2})]:
            add(subtype.lower() + '-' + label, 24, subtype, scene)
    for value in [47, -47, -.5, -1.5, .5]:
        add('integer-' + str(value), value, floating=False)
    return result


def unit_line(scene):
    return ' '.join(str(scene[name]) for name in DEFAULT_UNITS)


def generate():
    texts, ui_units, snaps, edit_formats = text_cases(), unit_cases(), snap_cases(), edit_format_cases()
    hashes = {}
    with tempfile.TemporaryDirectory(prefix='blender-property-text-') as directory:
        build = Path(directory)
        extra = prepare_text_sources(build, hashes)
        executable, prepared = units_build.build_native(
            build, build / 'property-number-text-oracle', extra_sources=extra,
            extra_flags=['-DWITH_PYTHON', *generate_advanced_fixtures.python_flags()])
        hashes.update(prepared['hashes'])
        generated = {path.name: units_build.digest(path) for path in build.iterdir()
                     if path.suffix in ['.cc', '.hh']}
        lines = []
        for case in texts:
            subtype, unit_type = SUBTYPES[case['subtype']]
            fields = [subtype, unit_type, int(case['isFloat']), case['factorDisplay']]
            values = [case[name] for name in ['hardMin', 'hardMax', 'softMin', 'softMax', 'initial']]
            lines.append('TEXT %s %s %s %s' % (' '.join(map(str, fields)), unit_line(case['units']),
                         ' '.join(map(str, values)), case['input'].encode().hex() or '-'))
        for case in ui_units:
            lines.append('UNIT %s %s %s %s %s' % (case['type'], unit_line(case['units']),
                         case['stepDefault'], case['value'], case['precision']))
        for case in snaps:
            fields = [int(case['mode'] == 'event'), case['type']]
            values = [*case['params'], len(case['events']), *case.get('bounds', []),
                      *[value for event in case['events'] for value in event]]
            lines.append('SNAP %s %s %s' % (' '.join(map(str, fields)), unit_line(case['units']),
                                          ' '.join(map(str, values))))
        for case in edit_formats:
            subtype, unit_type = SUBTYPES[case['subtype']]
            fields = [subtype, unit_type, int(case['isFloat']), case['factorDisplay'], case['stepDefault']]
            lines.append('EDIT %s %s %s' % (' '.join(map(str, fields)), unit_line(case['units']), case['value']))
        outputs = subprocess.check_output([str(executable)], input='\n'.join(lines) + '\n', text=True)
        output_rows = [json.loads(line) for line in outputs.splitlines()]
        assert len(output_rows) == len(texts) + len(ui_units) + len(snaps) + len(edit_formats)
        for case, output in zip(texts + ui_units + snaps + edit_formats, output_rows):
            if 'mode' in case:
                case.update(output)
            else:
                case['output'] = output
    for path in [Path(__file__), HERE / 'property-number-text-oracle.cc',
                 HERE / 'generate_advanced_fixtures.py']:
        hashes[str(path.relative_to(ROOT))] = units_build.digest(path)
    upstream = {}
    for name, digest in hashes.items():
        path = ROOT / name
        manifest = path.parent / 'UPSTREAM.json'
        if manifest.exists():
            record = json.loads(manifest.read_text()).get('files', {}).get(path.name)
            if record:
                assert record['sha256'] == digest
                upstream[name] = record
    metadata = dict(ref='v4.3.0', license='GPL-2.0-or-later',
                    pythonVersion=sys.version.split()[0], hashes=dict(sorted(hashes.items())),
                    upstream=dict(sorted(upstream.items())),
                    generatedTranslationUnits=dict(sorted(generated.items())),
                    sourceFunctions=['user_string_to_number', 'ui_but_is_unit_radians_ex', 'ui_but_is_unit',
                                     'ui_number_from_string_units', 'ui_number_from_string_units_with_but',
                                     'ui_number_from_string', 'ui_number_from_string_factor',
                                     'ui_number_from_string_percentage', 'ui_but_string_eval_number',
                                     'ui_but_string_set numeric branch', 'BPY_run_string_as_number', 'PyC_RunString_AsNumber',
                                     'ui_get_but_step_unit', 'ui_get_but_string_unit',
                                     'ui_but_string_get_ex numeric branch', 'BLI_str_rstrip_float_zero',
                                     'BKE_unit_name_to_alt',
                                     'ui_numedit_begin', 'ui_numedit_but_NUM', 'ui_do_but_NUM'],
                    boundaryModel=[
                        'Original full raw vendored v4.3.0 sources are SHA-checked against their UPSTREAM.json files.',
                        'Original PyC namespace/evaluation/numeric conversion executes against native CPython; no JS evaluator.',
                        'Complete original BPY_run_string_as_number executes, including empty-expression success0 before PyC. Context hooks acquire/release the native CPython GIL and error reporting remains an exception-class boundary.',
                        'RNA subtype, float/integer kind, hard float32 limits and explicit unit settings enter through host structs.',
                        'Original ui_but_string_set numeric branch executes floor(value + 0.5) and hard clamps; soft bounds do not clamp text.',
                        'ui_but_value_set captures the post-clamp double; downstream RNA setters and animation driver # branches are outside this oracle.',
                        'BPY reporting boundary records exception class, not full Blender traceback/UI report presentation.',
                        'BLI_strn_endswith uses the original strict end_len < str_len test: a single % is not stripped and fails as Python syntax; BPY empty success does not change that source behavior.',
                        'BLI_strdupn has only a void*-to-char* C++ allocation cast; original suffix detection and copy execute unchanged.',
                        'Unit formatting calls original ui_get_but_string_unit with explicit supplied precision; dynamic ui_but_string_get_ex precision is outside scope.',
                        'editFormats calls the original numeric ui_but_string_get_ex branch at precision6/use_exp_float=true, then original float zero stripping and unit alternate-name conversion; animated driver text is outside scope.',
                        'uiUnits formatted always calls the unit formatter directly, including isUnit=false diagnostic rows. The real nonunit field display bypasses this function.',
                        'NUM unit gate/base scalar/validity/step are obtained from original BKE/UI functions. The converted step enters number_begin before drag-map initialization, then number_units.',
                        'NUM adapter supplies RNA/context/window boundaries; original move, modifier snap, commit and cancellation branches execute unchanged. Host DOM/Undo behavior is outside scope.',
                    ])
    return dict(metadata=metadata, textCases=texts, uiUnits=ui_units, snapCases=snaps, editFormats=edit_formats)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = generate()
    encoded = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    if args.check:
        assert TARGET.read_text() == encoded, 'Native property number text fixtures changed'
    else:
        TARGET.write_text(encoded)
    print('Original Blender property number oracle: %d text cases, %d unit rows, %d snap cases / %d events, %d edit formats%s' %
          (len(result['textCases']), len(result['uiUnits']), len(result['snapCases']),
           sum(len(case['events']) for case in result['snapCases']), len(result['editFormats']),
           ' (checked)' if args.check else ''))


if __name__ == '__main__':
    main()
