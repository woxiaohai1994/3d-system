# SPDX-License-Identifier: GPL-2.0-or-later
"""Export real pose.copy/paste author channels; mute rig drivers to isolate the operator."""
import bpy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor/add-camera-rigs'
spec = importlib.util.spec_from_file_location(
    'add_camera_rigs', SOURCE / '__init__.py', submodule_search_locations=[str(SOURCE)]
)
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.preferences.addons.new().module = 'add_camera_rigs'


def build(kind):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    addon.build_rigs.build_camera_rig(bpy.context, kind)
    rig = bpy.context.object
    if rig.animation_data:
        for driver in rig.animation_data.drivers:
            driver.mute = True
    bpy.ops.object.mode_set(mode='POSE')
    return rig


def select(rig, names):
    for pose in rig.pose.bones:
        if hasattr(pose, 'select'):
            pose.select = pose.name in names
        else:
            pose.bone.select = pose.name in names


def state(rig):
    return {
        pose.name: {
            'location': list(pose.location),
            'rotation': list(pose.rotation_euler),
            'scale': list(pose.scale),
            'properties': {key: pose[key] for key in pose.keys() if isinstance(pose[key], (float, int))},
        }
        for pose in rig.pose.bones
    }


def seed(rig, source):
    for index, pose in enumerate(rig.pose.bones):
        assert pose.rotation_mode == 'XYZ', (pose.name, pose.rotation_mode)
        factor = index + 1
        pose.location = (factor * .13, factor * -.17, factor * .19) if source else (-.4, .6, -.8)
        pose.rotation_euler = (factor * .03, factor * -.04, factor * .05) if source else (-.21, .32, -.43)
        pose.scale = (1.1, .9, 1.2) if source else (.8, 1.3, .7)
        for key in pose.keys():
            if isinstance(pose[key], (float, int)):
                pose[key] = 27.5 if source else 12.5
    rig.pose.bones['Camera']['shared_test'] = 6.25 if source else -2.75
    rig.pose.bones['Camera']['source_only' if source else 'target_only'] = 3.5
    bpy.context.view_layer.update()


cases = []
for kind in ['DOLLY', 'CRANE', '2D']:
    for scenario in ['default', 'flipped', 'masked', 'mask_empty_target', 'copy_empty']:
        source_rig = build(kind)
        seed(source_rig, True)
        copied = [] if scenario == 'copy_empty' else ['Camera', 'Aim']
        select(source_rig, copied)
        source_state = state(source_rig)
        assert bpy.ops.pose.copy() == {'FINISHED'}
        target_rig = build(kind)
        seed(target_rig, False)
        selected = [] if scenario == 'mask_empty_target' else ['Aim'] if scenario == 'masked' else ['Root']
        select(target_rig, selected)
        before = state(target_rig)
        args = {}
        if scenario == 'flipped':
            args['flipped'] = True
        if scenario in ['masked', 'mask_empty_target']:
            args['selected_mask'] = True
        assert bpy.ops.pose.paste(**args) == {'FINISHED'}
        after = state(target_rig)
        cases.append(dict(type={'DOLLY': 'dolly', 'CRANE': 'crane', '2D': '2d'}[kind],
                          scenario=scenario, source=source_state, copied=copied,
                          selected=selected, options=args, before=before, after=after))

for copied in [['Left_Corner'], ['Left_Corner', 'Right_Corner']]:
    source_rig = build('2D')
    seed(source_rig, True)
    select(source_rig, copied)
    source_state = state(source_rig)
    assert bpy.ops.pose.copy() == {'FINISHED'}
    target_rig = build('2D')
    seed(target_rig, False)
    select(target_rig, ['Camera'])
    before = state(target_rig)
    assert bpy.ops.pose.paste(flipped=True) == {'FINISHED'}
    cases.append(dict(type='2d', scenario='flipped_corners', source=source_state, copied=copied,
                      selected=['Camera'], options={'flipped': True}, before=before, after=state(target_rig)))

source_rig = build('CRANE')
seed(source_rig, True)
select(source_rig, ['Crane_Arm', 'Camera'])
source_state = state(source_rig)
assert bpy.ops.pose.copy() == {'FINISHED'}
target_rig = build('DOLLY')
seed(target_rig, False)
select(target_rig, ['Root'])
before = state(target_rig)
assert bpy.ops.pose.paste() == {'FINISHED'}
cases.append(dict(type='dolly', scenario='cross_rig_missing_bone', source=source_state,
                  copied=['Crane_Arm', 'Camera'], selected=['Root'], options={},
                  before=before, after=state(target_rig)))

names = ['Camera', 'Aim', 'Root', 'Left_Corner', 'Right_Corner', 'Bone.L', 'Bone.R',
         'L-Bone', 'R_Bone', 'Bone.Left', 'bone.RIGHT', 'Left', 'Right', '.L',
         'Bone.L.001', 'Bone.Right.01', 'L.arm.R', 'bright']
fixture = dict(
    blender=bpy.app.version_string,
    blender_build_hash=bpy.app.build_hash.decode(),
    addon_build_sha256=hashlib.sha256((SOURCE / 'build_rigs.py').read_bytes()).hexdigest(),
    operators=['bpy.ops.pose.copy', 'bpy.ops.pose.paste'],
    rig_drivers_muted=True,
    scope='XYZ author channels and numeric ID properties; not evaluated depsgraph output',
    default_selected_mask=bpy.ops.pose.paste.get_rna_type().properties['selected_mask'].default,
    names=[dict(name=name, flipped=bpy.utils.flip_name(name, strip_digits=False)) for name in names],
    cases=cases,
)
destination = ROOT / 'tests/integration/fixtures/add-camera-rigs-pose-clipboard.json'
destination.write_text(json.dumps(fixture, separators=(',', ':')) + '\n')
print('Exported', len(cases), 'native pose clipboard cases to', destination)
