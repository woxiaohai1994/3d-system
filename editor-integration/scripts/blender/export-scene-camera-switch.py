# SPDX-License-Identifier: GPL-2.0-or-later
import bpy
import json
from pathlib import Path

scene = bpy.context.scene
cameras = {}
for name in ['A', 'B', 'C']:
    obj = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    scene.collection.objects.link(obj)
    cameras[name] = obj
cases = [[], [(20, 'B')], [(40, 'C'), (20, 'B')],
         [(20, 'B'), (20, 'C')], [(20, None), (40, 'C')]]
samples = []
for markers in cases:
    for marker in list(scene.timeline_markers):
        scene.timeline_markers.remove(marker)
    for frame, name in markers:
        marker = scene.timeline_markers.new('cam_' + str(frame), frame=frame)
        marker.camera = cameras[name] if name else None
    for frame in [-1, 0, 19, 20, 21, 39, 40, 41, 100]:
        scene.camera = cameras['A']
        scene.frame_set(frame)
        samples.append(dict(markers=[dict(frame=f, cameraId=n) for f, n in markers],
                            frame=frame, expected=scene.camera.name))
path = Path(__file__).resolve().parents[2] / 'tests/integration/fixtures/blender-scene-camera-switch.json'
path.write_text(json.dumps(dict(blender=bpy.app.version_string, samples=samples), indent=2) + '\n')
print(path)
