# SPDX-License-Identifier: GPL-3.0-or-later
"""Capture native linear Object channels and evaluated placement between keys."""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
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
bpy.context.preferences.addons.new().module = spec.name
bpy.context.preferences.edit.object_align = 'WORLD'
C = Matrix.Rotation(-math.pi / 2, 4, 'X')


def flat(matrix):
    return [matrix[row][column] for column in range(4) for row in range(4)]


def snapshot(rig):
    return dict(location=list(rig.location), rotation=list(rig.rotation_euler),
                scale=list(rig.scale), rotationMode=rig.rotation_mode,
                parentInverse=flat(C @ rig.matrix_parent_inverse @ C.inverted()))


cases = []
for kind in ['DOLLY', 'CRANE', '2D']:
    for parent_kind in ['none', 'scaled', 'mirrored']:
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        bpy.context.scene.frame_set(0)
        bpy.context.scene.cursor.location = (2.1, -1.3, 0.6)
        bpy.ops.object.build_camera_rig(mode=kind)
        rig = bpy.context.object
        if parent_kind != 'none':
            parent = bpy.data.objects.new('Animated rig parent', None)
            bpy.context.scene.collection.objects.link(parent)
            parent.location = (-2, 1.5, 0.8)
            parent.rotation_euler = (-0.15, 0.3, -0.25)
            parent.scale = (-1.3, 0.7, 1.1) if parent_kind == 'mirrored' else (1.3, 0.7, 1.1)
            bpy.context.view_layer.update()
            rig.parent = parent
            rig.matrix_parent_inverse = parent.matrix_world.inverted()
        endpoints = []
        for frame in [0, 2]:
            rig.location = (2.1 + frame * 0.5, -1.3, 0.6)
            rig.rotation_euler = (0, 0, frame * math.pi / 4)
            rig.scale = (1 + frame * 0.5, 1 - frame * 0.15, 1 + frame * 0.15)
            for path in ['location', 'rotation_euler', 'scale']:
                rig.keyframe_insert(path, frame=frame)
            bpy.context.view_layer.update()
            endpoints.append(dict(object=snapshot(rig), placement=flat(C @ rig.matrix_parent_inverse @ rig.matrix_basis @ C.inverted())))
        action = rig.animation_data.action
        bag = action.layers[0].strips[0].channelbag(rig.animation_data.action_slot)
        for curve in bag.fcurves:
            for key in curve.keyframe_points:
                key.interpolation = 'LINEAR'
        for frame in [0, 0.5, 1, 1.5, 2]:
            bpy.context.scene.frame_set(int(frame), subframe=frame - int(frame))
            bpy.context.view_layer.update()
            cases.append(dict(type={'DOLLY': 'dolly', 'CRANE': 'crane', '2D': '2d'}[kind],
                              parentKind=parent_kind, time=frame, progress=frame / 2,
                              endpoints=endpoints, object=snapshot(rig),
                              placement=flat(C @ rig.matrix_parent_inverse @ rig.matrix_basis @ C.inverted())))

result = dict(blender=bpy.app.version_string, buildHash=bpy.app.build_hash.decode(),
              source='add-camera-rigs@1.9.0',
              sourceSHA256=hashlib.sha256((SOURCE / 'build_rigs.py').read_bytes()).hexdigest(),
              interpolation='native LINEAR location / rotation_euler / scale FCurves', cases=cases)
output = ROOT / 'tests/integration/fixtures/add-camera-rigs-object-animation.json'
output.write_text(json.dumps(result, indent=2) + '\n')
print(f'Exported {len(cases)} native Object animation samples')
