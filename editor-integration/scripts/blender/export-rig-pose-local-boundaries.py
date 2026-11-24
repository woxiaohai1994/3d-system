# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent original rig LOCAL plane, active, parent-child and fallback operator cases."""
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


def record(rig, kind, selected, active, pivot, requested, mode, axis_mask, armature_scale=None):
    reset(rig, selected, active)
    if armature_scale is not None:
        rig.scale = armature_scale
        bpy.context.view_layer.update()
    bpy.context.scene.tool_settings.transform_pivot_point = pivot
    bpy.context.scene.cursor.location = (.4, 3, 2)
    before = state(rig)
    placement = flat(C @ rig.matrix_world @ C.inverted())
    matrices = {p.name: flat(C @ rig.matrix_world @ p.matrix)
                for p in rig.pose.bones if p.name in selected}
    constraint = [bool(axis_mask & (1 << axis)) for axis in range(3)]
    value = .4 if mode == 'rotate' else 1.3
    values = [1 if mode == 'scale' else 0] * 3
    for axis in range(3):
        if constraint[axis]:
            values[axis] = value
    with bpy.context.temp_override(area=area, region=region):
        if requested == 'translate':
            result = bpy.ops.transform.translate(value=values, orient_type='LOCAL',
                                                constraint_axis=constraint)
        elif requested == 'rotate':
            result = bpy.ops.transform.rotate(value=value,
                orient_axis='XYZ'[next(axis for axis in range(3) if constraint[axis])],
                orient_type='LOCAL', constraint_axis=constraint)
        else:
            result = bpy.ops.transform.resize(value=values, orient_type='LOCAL',
                                             constraint_axis=constraint)
    assert result == {'FINISHED'}
    bpy.context.view_layer.update()
    cases.append(dict(type=kind, selected=selected, active=active, pivot=pivot, mode=mode,
                      requestedMode=requested, axisMask=axis_mask, value=value,
                      placement=placement, before=before, after=state(rig),
                      boneWorldMatrices=matrices, armatureScale=armature_scale))


for original, kind in [('DOLLY', 'dolly'), ('CRANE', 'crane'), ('2D', '2d')]:
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    addon.build_rigs.build_camera_rig(bpy.context, original)
    rig = bpy.context.object
    if rig.mode != 'POSE':
        bpy.ops.object.mode_set(mode='POSE')
    selections = [(['Camera', 'Aim'], 'Root'), (['Root', 'Camera'], 'Camera'),
                  (['Camera', 'Camera_Offset'], 'Camera_Offset') if kind != '2d'
                  else (['Root', 'Aim'], 'Aim')]
    for selected, active in selections:
        for pivot in ['MEDIAN_POINT', 'ACTIVE_ELEMENT', 'INDIVIDUAL_ORIGINS']:
            for mode in ['translate', 'scale']:
                for mask in [3, 5, 6]:
                    record(rig, kind, selected, active, pivot, mode, mode, mask)
            for mask in [1, 2]:
                record(rig, kind, selected, active, pivot, 'rotate', 'rotate', mask)
    if kind == 'crane':
        for pivot in ['MEDIAN_POINT', 'ACTIVE_ELEMENT', 'INDIVIDUAL_ORIGINS']:
            for mask in [3, 5, 6]:
                record(rig, kind, ['Crane_Height', 'Crane_Arm'], 'Crane_Arm',
                       pivot, 'translate', 'scale', mask)
    for armature_scale in [(1e-20, 1e-20, 1e-20), (0, 0, 0)]:
        record(rig, kind, ['Root'], 'Root', 'MEDIAN_POINT', 'scale', 'scale', 1,
               armature_scale)

target = ROOT / 'tests/integration/fixtures/add-camera-rigs-pose-local-boundaries.json'
target.write_text(json.dumps(dict(blender=bpy.app.version_string,
    buildHash=bpy.app.build_hash.decode(), source='add-camera-rigs@1.9.0',
    sourceSHA256=hashlib.sha256((SOURCE / 'build_rigs.py').read_bytes()).hexdigest(),
    generatorSHA256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    operator='bpy.ops.transform LOCAL planar/active/parent-child/requested-fallback',
    cases=cases), separators=(',', ':')) + '\n')
print(f'Exported {len(cases)} actual LOCAL boundary operators ({bpy.app.version_string})')
