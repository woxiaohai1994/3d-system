# SPDX-License-Identifier: GPL-3.0-or-later
"""Record actual per-property F-Curves from the unmodified add-on's exported UI."""
from pathlib import Path
import json
import itertools
import math
import runpy

import bpy

ROOT = Path(__file__).resolve().parents[2]
context = runpy.run_path(str(ROOT / 'scripts/blender/export-camera-rig-ui.py'))
layout = context['result']
addon = context['addon']


def walk(tree):
    yield tree
    for child in tree['children']:
        yield from walk(child)


def curves(root):
    animation = root.animation_data
    if animation is None or animation.action is None:
        return []
    action = animation.action
    if hasattr(action, 'fcurves'):
        return list(action.fcurves)
    return [curve for layer in action.layers for strip in layer.strips
            if (bag := strip.channelbag(animation.action_slot)) is not None
            for curve in bag.fcurves]


def snapshot(fcurve):
    return dict(keys=[dict(co=list(p.co), left=list(p.handle_left), right=list(p.handle_right),
                         leftType=p.handle_left_type, rightType=p.handle_right_type,
                         interpolation=p.interpolation) for p in fcurve.keyframe_points],
                samples=[dict(frame=frame, value=fcurve.evaluate(frame))
                         for frame in [-2, 1, 1.125, 3, 6.9, 7, 7.001, 11, 19, 25, 40, 43, 50]])


cases = []
for kind, pattern in itertools.product(['dolly', 'crane', '2d'], ['peaks', 'rising', 'plateau']):
    addon.build_rigs.build_camera_rig(bpy.context, kind.upper())
    rig = bpy.context.active_object
    camera = next(child for child in rig.children if child.type == 'CAMERA')
    owners = {'rig': rig, 'camera': camera, 'cameraData': camera.data}
    properties = {}
    for variant, entries in layout['variants'].items():
        if not variant.startswith(kind + ':'):
            continue
        for entry in entries:
            for tree in walk(layout['trees'][entry['body']]):
                o = tree['options']
                rna = o.get('rna', {})
                if (tree['kind'] not in ('prop', 'decorator') or
                        not rna.get('is_animatable') or rna.get('driven_indices')):
                    continue
                if not (o.get('decorate') or tree['kind'] == 'decorator'):
                    continue
                key = (o['owner'], rna['data_path'], o.get('index', -1))
                properties[key] = o
    for (role, data_path, index), o in properties.items():
        root = owners[role]
        owner = root.path_resolve(o['path']) if o['path'] else root
        name = o['property']
        custom = name.startswith('["')
        name = name[2:-2] if custom else name
        old = owner[name] if custom else getattr(owner, name)
        old = old[index] if index >= 0 else old
        rna = o['rna']
        if rna['type'] == 'BOOLEAN':
            values = [False, True, False, True]
        elif rna['type'] == 'ENUM':
            values = [item['value'] for item in rna['items']]
            values = (values * 4)[:4]
        else:
            lo = rna.get('min', rna.get('hard_min', -math.inf))
            hi = rna.get('max', rna.get('hard_max', math.inf))
            amplitude = min(max(abs(old) * .3, .25), (hi - lo) / 10)
            deltas = {'peaks': [0, 1, -.3, .8], 'rising': [-.8, -.2, .2, .8],
                      'plateau': [0, 1, 1, 2]}[pattern]
            values = [max(lo, min(hi, old + amplitude * delta)) for delta in deltas]

        def assign(value):
            if custom:
                owner[name] = value
            elif index >= 0:
                getattr(owner, name)[index] = value
            else:
                setattr(owner, name, value)

        frames = [1, 7, 19, 43]
        for frame, value in zip(frames, values):
            assign(value)
            assert root.keyframe_insert(data_path=data_path, index=index, frame=frame)
        matching = [f for f in curves(root) if f.data_path == data_path and
                    (index < 0 or f.array_index == index)]
        assert len(matching) == 1, (kind, role, data_path, index)
        fcurve = matching[0]
        record = dict(rig=kind, pattern=pattern, owner=role, path=data_path, index=fcurve.array_index,
                      type=rna['type'], values=values,
                      smoothing=fcurve.auto_smoothing, extrapolation=fcurve.extrapolation,
                      **snapshot(fcurve), edits=[])
        cases.append(record)
        for frame, value in [(7, fcurve.keyframe_points[1].co.y + .25), (11, fcurve.evaluate(11))]:
            fcurve.keyframe_points.insert(frame, value)
            record['edits'].append(dict(operation='insert', frame=frame, value=value, **snapshot(fcurve)))
        for frame in [19, 7, 1, 11, 43]:
            fcurve.keyframe_points.remove(next(p for p in fcurve.keyframe_points if p.co.x == frame))
            record['edits'].append(dict(operation='delete', frame=frame, **snapshot(fcurve)))

        assign(old)

result = dict(blenderVersion=bpy.app.version_string, source=layout['source'],
              hashes=layout['hashes'], cases=cases)
output = ROOT / 'tests/integration/fixtures/add-camera-rigs-property-animation.json'
output.write_text(json.dumps(result, separators=(',', ':')) + '\n')
print(f'Exported {len(cases)} actual Blender property curves and {sum(len(c["samples"]) for c in cases)} evaluations')
