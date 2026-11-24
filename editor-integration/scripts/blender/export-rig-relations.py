# SPDX-License-Identifier: GPL-3.0-or-later
"""Export original rig visibility/connectivity and native pose relation endpoints."""
from pathlib import Path
import hashlib
import importlib.util
import json
import math
import sys
import bpy
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor/add-camera-rigs'
spec = importlib.util.spec_from_file_location('add_camera_rigs', SOURCE / '__init__.py',
    submodule_search_locations=[str(SOURCE)])
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.preferences.addons.new().module = 'add_camera_rigs'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
C = Matrix.Rotation(-math.pi / 2, 4, 'X')

def matrix(value):
    return [value[r][c] for c in range(4) for r in range(4)]

def visible(bone):
    return not bone.hide and any(collection.is_visible_effectively for collection in bone.collections)

metadata = {'blender': bpy.app.version_string, 'hashes': {
    str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
    for path in [SOURCE / 'build_rigs.py', SOURCE / 'create_widgets.py', Path(__file__).resolve()]
}, 'color': list(bpy.context.preferences.themes[0].view_3d.wire), 'types': {}}
cases = []
for kind in ['dolly', 'crane', '2d']:
    addon.build_rigs.build_camera_rig(bpy.context, kind.upper())
    rig = bpy.context.active_object
    bpy.context.view_layer.update()
    defaults = {p.name: {'location': list(p.location), 'rotation': list(p.rotation_euler),
        'scale': list(p.scale), 'properties': {k: float(v) for k, v in p.items()
            if isinstance(v, (int, float)) and k != 'lens_without_breathing'}}
        for p in rig.pose.bones if not p.name.startswith('MCH-')}
    metadata['types'][kind] = {'fromHead': rig.data.relation_line_position == 'HEAD',
        'bones': [{'name': p.name, 'parent': p.parent.name if p.parent else None,
            'connected': p.bone.use_connect, 'visible': visible(p.bone), 'length': p.bone.length}
            for p in rig.pose.bones]}
    changes = [{}, {'Root': {'location': [2, 3, -1], 'rotation': [.15, -.2, .4],
        'scale': [2, .7, 1.4]}, 'Camera': {'location': [1, -2, .5]},
        'Aim': {'location': [2, 1, 3]}}]
    if kind == 'crane':
        changes += [{'Crane_Height': {'scale': [1, 2, 1]}, 'Crane_Arm': {
            'scale': [1, 3, 1], 'rotation': [.4, 0, .7]}}]
    for change in changes:
        for p in rig.pose.bones:
            p.matrix_basis = Matrix.Identity(4)
        for name, values in change.items():
            p = rig.pose.bones[name]
            for field, value in values.items():
                setattr(p, 'rotation_euler' if field == 'rotation' else field, value)
        rig.update_tag()
        bpy.context.view_layer.update()
        erig = rig.evaluated_get(bpy.context.evaluated_depsgraph_get())
        bones = {name: dict(value, **change.get(name, {})) for name, value in defaults.items()}
        heads = {p.name: list(C @ erig.matrix_world @ p.head) for p in erig.pose.bones}
        tails = {p.name: list(C @ erig.matrix_world @ p.tail) for p in erig.pose.bones}
        for selected in [[], ['Root'], ['Camera'], ['Aim'], list(defaults)]:
            for from_head in [False, True]:
                expected = [{'name': p.name, 'parent': p.parent.name,
                    'start': heads[p.name], 'end': heads[p.parent.name] if from_head else tails[p.parent.name]}
                    for p in erig.pose.bones if visible(p.bone) and p.parent and not p.bone.use_connect
                        and (p.name in selected or p.parent.name in selected)]
                cases.append({'request': {'type': kind, 'bones': bones, 'aspect': 16 / 9,
                    'projection': 'perspective', 'sensorWidth': 36, 'orthographicHeight': 20,
                    'tracking': 1, 'focusOnAim': False}, 'selected': selected,
                    'fromHead': from_head, 'expected': expected})
target = ROOT / 'packages/editor/src/components/scene-camera/rig-relations-metadata.json'
target.write_text(json.dumps(metadata, separators=(',', ':')) + '\n')
(ROOT / 'tests/integration/fixtures/blender-rig-relations.json').write_text(
    json.dumps({'hashes': metadata['hashes'], 'cases': cases}, separators=(',', ':')) + '\n')
print('Exported source relation metadata and', len(cases), 'native pose endpoint cases')
