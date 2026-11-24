# SPDX-License-Identifier: GPL-3.0-or-later
"""Record original multi-control LOCAL transform operators and the default G-to-S fallback."""
import hashlib
import importlib.util
import json
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
C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
flat = lambda matrix: [matrix[row][column] for column in range(4) for row in range(4)]
area = next(a for a in bpy.context.screen.areas if a.type == 'VIEW_3D')
region = next(r for r in area.regions if r.type == 'WINDOW')


def state(rig):
    return {p.name: dict(location=list(p.location), rotation=list(p.rotation_euler),
                        scale=list(p.scale), properties={k: float(v) for k, v in p.items()
                        if isinstance(v, (int, float))}) for p in rig.pose.bones
            if p.custom_shape or p.name in ['Crane_Height', 'Crane_Arm']}


def reset(rig, selected, active):
    for p in rig.pose.bones:
        p.matrix_basis = Matrix.Identity(4)
        p.select = p.name in selected
    rig.matrix_world = Matrix.Identity(4)
    rig.rotation_euler = (.2, .4, -.3)
    rig.scale = (1.3, .8, 1.1)
    rig.pose.bones['Root'].rotation_euler = (.4, -.2, .7)
    rig.pose.bones['Root'].scale = (1.5, .6, 2)
    rig.pose.bones['Aim'].rotation_euler = (-.45, .2, -.35)
    rig.pose.bones['Camera'].rotation_euler = (.25, -.3, .55)
    rig.data.bones.active = rig.data.bones[active]
    bpy.context.view_layer.update()


cases = []
for kind in ['DOLLY', 'CRANE', '2D']:
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    addon.build_rigs.build_camera_rig(bpy.context, kind)
    rig = bpy.context.object
    if rig.mode != 'POSE':
        bpy.ops.object.mode_set(mode='POSE')
    for pivot in ['MEDIAN_POINT', 'INDIVIDUAL_ORIGINS']:
        for mode in ['translate', 'rotate', 'scale']:
            for axis in [0, 1]:
                selected, active = ['Camera', 'Aim'], 'Aim'
                reset(rig, selected, active)
                bpy.context.scene.tool_settings.transform_pivot_point = pivot
                before = state(rig)
                placement = flat(C @ rig.matrix_world @ C.inverted())
                matrices = {p.name: flat(C @ rig.matrix_world @ p.matrix)
                            for p in rig.pose.bones if p.name in selected}
                constraint = [False] * 3
                constraint[axis] = True
                value = .4 if mode == 'rotate' else 1.3
                values = [1 if mode == 'scale' else 0] * 3
                values[axis] = value
                with bpy.context.temp_override(area=area, region=region):
                    if mode == 'translate':
                        result = bpy.ops.transform.translate(value=values, orient_type='LOCAL',
                                                            constraint_axis=constraint)
                    elif mode == 'rotate':
                        result = bpy.ops.transform.rotate(value=value, orient_axis='XYZ'[axis],
                                                         orient_type='LOCAL', constraint_axis=constraint)
                    else:
                        result = bpy.ops.transform.resize(value=values, orient_type='LOCAL',
                                                         constraint_axis=constraint)
                assert result == {'FINISHED'}
                bpy.context.view_layer.update()
                after_matrices = {p.name: flat(C @ rig.matrix_world @ p.matrix)
                                  for p in rig.pose.bones if p.name in selected}
                cases.append(dict(type={'DOLLY': 'dolly', 'CRANE': 'crane', '2D': '2d'}[kind],
                                  selected=selected, active=active, pivot=pivot, mode=mode,
                                  requestedMode=mode, axis=axis, value=value,
                                  placement=placement, before=before, after=state(rig),
                                  boneWorldMatrices=matrices, boneWorldMatricesAfter=after_matrices))
    if kind == 'CRANE':
        selected, active = ['Crane_Height', 'Crane_Arm'], 'Crane_Arm'
        reset(rig, selected, active)
        bpy.context.scene.tool_settings.transform_pivot_point = 'INDIVIDUAL_ORIGINS'
        before = state(rig)
        placement = flat(C @ rig.matrix_world @ C.inverted())
        matrices = {p.name: flat(C @ rig.matrix_world @ p.matrix)
                    for p in rig.pose.bones if p.name in selected}
        with bpy.context.temp_override(area=area, region=region):
            result = bpy.ops.transform.translate(value=(1, 1.3, 1), orient_type='LOCAL',
                                                constraint_axis=(False, True, False))
        assert result == {'FINISHED'}
        bpy.context.view_layer.update()
        after_matrices = {p.name: flat(C @ rig.matrix_world @ p.matrix)
                          for p in rig.pose.bones if p.name in selected}
        cases.append(dict(type='crane', selected=selected, active=active,
                          pivot='INDIVIDUAL_ORIGINS', mode='scale', requestedMode='translate',
                          axis=1, value=1.3, placement=placement, before=before,
                          after=state(rig), boneWorldMatrices=matrices,
                          boneWorldMatricesAfter=after_matrices))

result = dict(blender=bpy.app.version_string, buildHash=bpy.app.build_hash.decode(),
              source='add-camera-rigs@1.9.0',
              sourceSHA256=hashlib.sha256((SOURCE / 'build_rigs.py').read_bytes()).hexdigest(),
              generatorSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              operator='bpy.ops.transform.translate/rotate/resize orient_type=LOCAL', cases=cases)
(ROOT / 'tests/integration/fixtures/add-camera-rigs-pose-local-multi.json').write_text(
    json.dumps(result, separators=(',', ':')) + '\n')
print(f'Exported {len(cases)} actual multi-control LOCAL operators ({bpy.app.version_string})')
