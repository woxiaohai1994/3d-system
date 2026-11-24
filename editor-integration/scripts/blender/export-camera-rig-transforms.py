# SPDX-License-Identifier: GPL-3.0-or-later
"""Record original pose-mode world scaling, including source locks and sheared parents."""
import bpy
import importlib.util
import json
import math
from pathlib import Path
import sys
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[2]
source = ROOT / 'vendor/add-camera-rigs'
spec = importlib.util.spec_from_file_location('add_camera_rigs', source / '__init__.py', submodule_search_locations=[str(source)])
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.preferences.addons.new().module = 'add_camera_rigs'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
C = Matrix.Rotation(-math.pi / 2, 4, 'X')
cases = []
for kind in ['DOLLY', 'CRANE', '2D']:
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    addon.build_rigs.build_camera_rig(bpy.context, kind)
    rig = bpy.context.object
    if rig.mode != 'POSE': bpy.ops.object.mode_set(mode='POSE')
    for name in [p.name for p in rig.pose.bones if p.custom_shape and not all(p.lock_scale)]:
        for variant in ['rotated', 'parent-shear', 'mirrored']:
            for axis in range(3):
                for factor in [2, -.7, 0]:
                    for p in rig.pose.bones:
                        p.matrix_basis = Matrix.Identity(4)
                        p.select = p.name == name
                    rig.matrix_world = Matrix.Identity(4)
                    p = rig.pose.bones[name]
                    p.rotation_euler = (.3, -.4, .6)
                    p.scale = (-1, 2, .7) if variant == 'mirrored' else (1.2, .8, 1.4)
                    if variant == 'parent-shear':
                        rig.rotation_euler = (.2, .4, -.3)
                        rig.scale = (2, .7, 1.3)
                        if name != 'Root':
                            rig.pose.bones['Root'].rotation_euler = (.4, -.2, .7)
                            rig.pose.bones['Root'].scale = (1.5, .6, 2)
                    rig.data.bones.active = rig.data.bones[name]
                    bpy.context.view_layer.update()
                    basis = C @ rig.matrix_world @ p.matrix
                    initial = list(p.scale)
                    # System Y is Blender Z; a sign change of an axis does not affect scale.
                    blender_axis = [0, 2, 1][axis]
                    value = [1, 1, 1]
                    value[blender_axis] = factor
                    axes = [False, False, False]
                    axes[blender_axis] = True
                    bpy.ops.transform.resize(value=value, orient_type='GLOBAL', constraint_axis=axes)
                    bpy.context.view_layer.update()
                    cases.append(dict(type=kind, bone=name, variant=variant, axis=axis, factor=factor,
                                      basis=[basis[r][c] for c in range(4) for r in range(4)],
                                      initial=initial, locks=list(p.lock_scale), expected=list(p.scale)))
out = ROOT / 'tests/integration/fixtures/add-camera-rigs-transforms.json'
out.write_text(json.dumps(cases, separators=(',', ':')))
print('Exported', len(cases), 'original pose scaling cases')
