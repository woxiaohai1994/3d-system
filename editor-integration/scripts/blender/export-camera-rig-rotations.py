# SPDX-License-Identifier: GPL-3.0-or-later
"""Record native rig rotation channels and compatible Euler sequences in Blender."""
import bpy
import importlib.util
import json
import math
import sys
from pathlib import Path
from mathutils import Euler, Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
source = ROOT / 'vendor/add-camera-rigs'
spec = importlib.util.spec_from_file_location('add_camera_rigs', source / '__init__.py', submodule_search_locations=[str(source)])
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.preferences.addons.new().module = 'add_camera_rigs'
C = Matrix.Rotation(-math.pi / 2, 4, 'X')
flat = lambda m: [m[r][c] for c in range(4) for r in range(4)]
visible = lambda p: p.custom_shape or p.name in ['Crane_Height', 'Crane_Arm']
state = lambda rig: {p.name: dict(location=list(p.location), rotation=list(p.rotation_euler), scale=list(p.scale), properties={k:p[k] for k in p.keys() if isinstance(p[k],(float,int))}) for p in rig.pose.bones if visible(p)}
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
    for name in [p.name for p in rig.pose.bones if visible(p)]:
        for variant in ['rest', 'parent-shear', 'mirrored']:
            for axis in range(3):
                for angle in [.45, math.radians(450), math.radians(-720)]:
                    for p in rig.pose.bones:
                        p.matrix_basis = Matrix.Identity(4)
                        p.select = p.name == name
                    rig.matrix_world = Matrix.Identity(4)
                    p = rig.pose.bones[name]
                    p.location = (.2,.3,-.4)
                    p.rotation_euler = (.3,-.4,.6)
                    if variant != 'rest':
                        rig.rotation_euler = (.2,.4,-.3)
                        rig.scale = (2,.7,1.3)
                        if name != 'Root':
                            rig.pose.bones['Root'].rotation_euler = (.4,-.2,.7)
                            rig.pose.bones['Root'].scale = (1.5,.6,2)
                        if variant == 'mirrored':
                            rig.scale.x *= -1
                    rig.data.bones.active = rig.data.bones[name]
                    bpy.context.view_layer.update()
                    before = state(rig)
                    placement = flat(C @ rig.matrix_world @ C.inverted())
                    axis_b = [0,2,1][axis]
                    axes = [False]*3
                    axes[axis_b] = True
                    bpy.context.scene.tool_settings.transform_pivot_point = 'INDIVIDUAL_ORIGINS'
                    with bpy.context.temp_override(area=area, region=region):
                        bpy.ops.transform.rotate(value=angle * (-1 if axis == 2 else 1), orient_axis='XYZ'[axis_b], orient_type='GLOBAL', constraint_axis=axes)
                    bpy.context.view_layer.update()
                    cases.append(dict(type={'DOLLY':'dolly','CRANE':'crane','2D':'2d'}[kind], bone=name, variant=variant, axis=axis, angle=angle, before=before, placement=placement, rotation=list(p.rotation_euler)))

sequences = []
for initial in [[0,0,0], [.3,-.4,.6], [7.1,-8.3,12.9]]:
    for axis in [[1,0,0], [0,1,0], [0,0,1], [.3,.8,-.2]]:
        for sign in [1,-1]:
            base = Euler(initial, 'XYZ').to_matrix()
            previous = Euler(initial, 'XYZ')
            steps = []
            for degree in range(0, 1081, 15):
                matrix = Matrix.Rotation(math.radians(degree*sign), 3, Vector(axis).normalized()) @ base
                previous = matrix.to_euler('XYZ', previous)
                steps.append(dict(matrix=[list(matrix.col[i]) for i in range(3)], rotation=list(previous)))
            sequences.append(dict(initial=initial, axis=axis, sign=sign, steps=steps))
out = ROOT / 'tests/integration/fixtures/add-camera-rigs-rotations.json'
out.write_text(json.dumps(dict(blender=bpy.app.version_string,cases=cases,sequences=sequences),separators=(',',':'))+'\n')
print('Exported', len(cases), 'native rotation transforms and', sum(len(s['steps']) for s in sequences), 'Euler steps')
print('First large rotation:', cases[1]['rotation'])
