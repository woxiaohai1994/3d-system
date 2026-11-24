# SPDX-License-Identifier: GPL-3.0-or-later
"""Record real Blender undo/redo for unkeyed rig RNA values and key insertion."""
import bpy
import importlib.util
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
source = ROOT / 'vendor/add-camera-rigs'
spec = importlib.util.spec_from_file_location('add_camera_rigs', source / '__init__.py', submodule_search_locations=[str(source)])
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.preferences.addons.new().module = 'add_camera_rigs'
addon.build_rigs.build_camera_rig(bpy.context, 'DOLLY')
name = bpy.context.object.name
path = 'pose.bones["Camera"]["lens"]'
records = []

def record(action):
    bpy.context.view_layer.update()
    rig = bpy.data.objects[name]
    curves = rig.animation_data.action.fcurve_ensure_for_datablock(rig, path)
    records.append(dict(action=action, frame=bpy.context.scene.frame_current,
                        value=rig.pose.bones['Camera']['lens'],
                        keys=[list(k.co) for k in curves.keyframe_points]))

def set_value(value):
    rig = bpy.data.objects[name]
    rig.pose.bones['Camera']['lens'] = value
    rig.update_tag()
    bpy.context.view_layer.update()

for frame, value in [(0, 24), (24, 70)]:
    bpy.context.scene.frame_set(frame)
    set_value(value)
    bpy.data.objects[name].keyframe_insert(data_path=path, frame=frame)
    bpy.ops.ed.undo_push(message='Insert rig lens key')
    record('key')

bpy.context.scene.frame_set(12)
record('seek')
for value in [100, 120]:
    set_value(value)
    bpy.ops.ed.undo_push(message='Edit rig lens value')
    record('value')
for action in ['undo', 'undo', 'redo', 'redo']:
    getattr(bpy.ops.ed, action)()
    record(action)
bpy.data.objects[name].keyframe_insert(data_path=path)
bpy.ops.ed.undo_push(message='Insert edited rig lens key')
record('key')
for action in ['undo', 'undo', 'redo', 'redo']:
    getattr(bpy.ops.ed, action)()
    record(action)

out = ROOT / 'tests/integration/fixtures/add-camera-rigs-property-history.json'
paths = ['vendor/add-camera-rigs/build_rigs.py', 'vendor/blender-property-decorators/interface_handlers.cc']
hashes = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in paths}
out.write_text(json.dumps(dict(blender=bpy.app.version_string, hashes=hashes, records=records), indent=2)+'\n')
print(json.dumps(records))
