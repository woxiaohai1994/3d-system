# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent Blender Camera.view_frame and actual rig-camera matrix oracles."""
import bpy
import importlib.util
import json
import math
from pathlib import Path
import sys
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
scene = bpy.context.scene
cases = []
data = bpy.data.cameras.new('CameraDisplayOracle')
for lens in [1, 50, 1000]:
    for width, height in [(1920, 1080), (1080, 1920), (1440, 1440)]:
        for fit in ['AUTO', 'HORIZONTAL', 'VERTICAL']:
            for projection in ['PERSP', 'ORTHO']:
                for shift in [(0, 0), (.3, -.2)]:
                    scene.render.resolution_x = width
                    scene.render.resolution_y = height
                    data.lens = lens
                    data.sensor_width = 36
                    data.sensor_height = 24
                    data.sensor_fit = fit
                    data.type = projection
                    data.ortho_scale = 6
                    data.shift_x, data.shift_y = shift
                    cases.append(dict(lens=lens, width=width, height=height, fit=fit,
                                      projection=projection, shift=shift,
                                      frame=[list(v) for v in data.view_frame(scene=scene)]))

SOURCE = ROOT / 'vendor/add-camera-rigs'
spec = importlib.util.spec_from_file_location('add_camera_rigs', SOURCE / '__init__.py', submodule_search_locations=[str(SOURCE)])
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.preferences.addons.new().module = 'add_camera_rigs'
C = Matrix.Rotation(-math.pi / 2, 4, 'X')
def matrix(m):
    return [m[r][c] for c in range(4) for r in range(4)]
rig_cases = []
for kind in ['dolly', 'crane', '2d']:
    addon.build_rigs.build_camera_rig(bpy.context, kind.upper())
    rig = bpy.context.active_object
    cam = next(o for o in rig.children if o.type == 'CAMERA')
    cam.matrix_basis = cam.matrix_basis @ Matrix.Translation(Vector((2, -1, .5)))
    if kind == '2d':
        rig.pose.bones['Camera']['rotation_shift'] = 1
        rig.pose.bones['Aim'].location.x = 2
    cam.data.shift_x = .3
    cam.data.shift_y = -.2
    rig.update_tag();cam.data.update_tag();bpy.context.view_layer.update()
    for aspect in [16/9, 9/16]:
        scene.render.resolution_x = round(1440*aspect)
        scene.render.resolution_y = 1440
        bpy.context.view_layer.update()
        ecam = cam.evaluated_get(bpy.context.evaluated_depsgraph_get())
        bones = {p.name:dict(location=list(p.location), rotation=list(p.rotation_euler), scale=list(p.scale),
                             properties={k:float(v) for k,v in p.items() if isinstance(v,(int,float)) and k != 'lens_without_breathing'})
                 for p in rig.pose.bones if not p.name.startswith('MCH-')}
        # The plugin's 2D shift drivers remain authoritative; native host shift is additive.
        rig_cases.append(dict(type=kind, aspect=aspect, bones=bones,
                              offset=matrix(Matrix.Translation(Vector((2, -1, .5)))),
                              cameraMatrix=matrix(C @ ecam.matrix_world), lens=ecam.data.lens,
                              sourceShift=[ecam.data.shift_x, ecam.data.shift_y],
                              frame=[list(v) for v in ecam.data.view_frame(scene=scene)]))
(ROOT / 'tests/integration/fixtures/blender-camera-view-frame.json').write_text(json.dumps(dict(blenderVersion=bpy.app.version_string, cases=cases, rigs=rig_cases), separators=(',',':'))+'\n')
print('Exported Camera.view_frame:', len(cases), 'cases and', len(rig_cases), 'actual rig-body matrices')
