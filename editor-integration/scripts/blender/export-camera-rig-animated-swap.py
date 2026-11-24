# SPDX-License-Identifier: GPL-3.0-or-later
"""Observe original Swap Lens writes while its lens property has an F-Curve."""
import bpy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
source = ROOT / 'vendor/add-camera-rigs'
spec = importlib.util.spec_from_file_location('add_camera_rigs', source / '__init__.py',
                                            submodule_search_locations=[str(source)])
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.preferences.addons.new().module = 'add_camera_rigs'
path = 'pose.bones["Camera"]["lens"]'
cases = []

for kind in ['DOLLY', 'CRANE']:
    addon.build_rigs.build_camera_rig(bpy.context, kind)
    rig = bpy.context.object
    name = rig.name
    records = []

    def record(action, argument=None):
        bpy.context.view_layer.update()
        rig = bpy.data.objects[name]
        camera = rig.pose.bones['Camera']
        curve = rig.animation_data.action.fcurve_ensure_for_datablock(rig, path)
        records.append(dict(action=action, argument=argument,
                            frame=bpy.context.scene.frame_current,
                            lens=camera['lens'], location=list(camera.location),
                            keys=[list(key.co) for key in curve.keyframe_points]))

    for frame, value in [(0, 24), (24, 70)]:
        bpy.context.scene.frame_set(frame)
        rig.pose.bones['Camera']['lens'] = float(value)
        rig.keyframe_insert(data_path=path, frame=frame)
        record('key', value)
    bpy.context.scene.frame_set(12)
    record('seek', 12)
    for lens in [85, 120, 35]:
        bpy.ops.add_camera_rigs.swap_lens('EXEC_DEFAULT', camera_lens=lens)
        rig.update_tag()
        record('swap', lens)
    bpy.context.scene.frame_set(13)
    record('seek', 13)
    bpy.context.scene.frame_set(12)
    record('seek', 12)
    cases.append(dict(type=kind.lower(), records=records))

output = ROOT / 'tests/integration/fixtures/add-camera-rigs-animated-swap.json'
hashes = {name: hashlib.sha256((source / name).read_bytes()).hexdigest()
          for name in ['operators.py', 'build_rigs.py']}
output.write_text(json.dumps(dict(blender=bpy.app.version_string, hashes=hashes, cases=cases), indent=2)+'\n')
print(json.dumps(cases))
