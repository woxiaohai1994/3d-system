# SPDX-License-Identifier: GPL-3.0-or-later
"""Record actual Blender single-bone LOCAL translation directions from the original rig."""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor/add-camera-rigs'
spec = importlib.util.spec_from_file_location('add_camera_rigs', SOURCE / '__init__.py',
                                            submodule_search_locations=[str(SOURCE)])
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.preferences.addons.new().module = spec.name
C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
flat = lambda matrix: [matrix[row][column] for column in range(4) for row in range(4)]
area = next(a for a in bpy.context.screen.areas if a.type == 'VIEW_3D')
region = next(r for r in area.regions if r.type == 'WINDOW')
cases = []
for kind in ['DOLLY', 'CRANE', '2D']:
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    addon.build_rigs.build_camera_rig(bpy.context, kind)
    rig = bpy.context.object
    if rig.mode != 'POSE':
        bpy.ops.object.mode_set(mode='POSE')
    controls = [name for name in ['Root', 'Camera', 'Camera_Offset', 'Aim', 'Root_Tweak']
                if name in rig.pose.bones]
    for name in controls:
        variants = ['rest', 'parent-scaled', 'mirrored']
        if name == 'Root':
            variants += ['zero-tangent', 'zero-normal', 'zero-both']
        for variant in variants:
            for axis in range(3):
                for channel in rig.pose.bones:
                    channel.matrix_basis = Matrix.Identity(4)
                    channel.select = channel.name == name
                rig.matrix_world = Matrix.Identity(4)
                pchan = rig.pose.bones[name]
                pchan.location = (.2, .3, -.4)
                pchan.rotation_euler = (.3, -.4, .6)
                if variant in ['parent-scaled', 'mirrored']:
                    rig.rotation_euler = (.2, .4, -.3)
                    rig.scale = (-2, .7, 1.3) if variant == 'mirrored' else (2, .7, 1.3)
                    if name != 'Root':
                        rig.pose.bones['Root'].rotation_euler = (.4, -.2, .7)
                        rig.pose.bones['Root'].scale = (1.5, .6, 2)
                elif variant.startswith('zero-'):
                    pchan.scale = (1, 0, 1) if variant == 'zero-tangent' else (1, 1, 0) if variant == 'zero-normal' else (1, 0, 0)
                rig.data.bones.active = rig.data.bones[name]
                bpy.context.scene.tool_settings.transform_pivot_point = 'MEDIAN_POINT'
                bpy.context.view_layer.update()
                armature = C @ rig.matrix_world @ C.inverted()
                bone = C @ rig.matrix_world @ pchan.matrix
                before = C @ rig.matrix_world @ pchan.head
                value = Vector((0, 0, 0))
                value[axis] = 1
                constrained = [False] * 3
                constrained[axis] = True
                with bpy.context.temp_override(area=area, region=region):
                    result = bpy.ops.transform.translate(value=value, orient_type='LOCAL',
                                                        constraint_axis=constrained)
                assert result == {'FINISHED'}, (kind, name, variant, axis, result)
                bpy.context.view_layer.update()
                after = C @ rig.matrix_world @ pchan.head
                cases.append(dict(type={'DOLLY': 'dolly', 'CRANE': 'crane', '2D': '2d'}[kind],
                                  bone=name, variant=variant, axis=axis,
                                  armature=flat(armature), displayedBoneWorld=flat(bone),
                                  locks=list(pchan.lock_location), delta=list(after-before)))
result = dict(blender=bpy.app.version_string, buildHash=bpy.app.build_hash.decode(),
              source='add-camera-rigs@1.9.0',
              sourceSHA256=hashlib.sha256((SOURCE / 'build_rigs.py').read_bytes()).hexdigest(),
              generatorSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              operator='bpy.ops.transform.translate orient_type=LOCAL single bone', cases=cases)
(ROOT / 'tests/integration/fixtures/add-camera-rigs-pose-local-orientation.json').write_text(
    json.dumps(result, separators=(',', ':')) + '\n')
print(f'Exported {len(cases)} actual Blender LOCAL directions ({bpy.app.version_string})')
