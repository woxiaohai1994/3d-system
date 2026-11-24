# SPDX-License-Identifier: GPL-3.0-or-later
"""Render source-rig near/focus/far edge profiles for photographic DOF comparison."""
import importlib.util
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor/add-camera-rigs'
OUTPUT = ROOT / '.integration-audit/camera-rigs-dof'
OUTPUT.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('add_camera_rigs', SOURCE / '__init__.py', submodule_search_locations=[str(SOURCE)])
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.preferences.addons.new().module = 'add_camera_rigs'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 256
scene.cycles.use_denoising = False
scene.cycles.seed = 41
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.film_transparent = False
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
scene.world.use_nodes = True
scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value = (0, 0, 0, 1)
material = bpy.data.materials.new('DOF reference white')
material.use_nodes = True
material.node_tree.nodes.clear()
emission = material.node_tree.nodes.new('ShaderNodeEmission')
surface = material.node_tree.nodes.new('ShaderNodeOutputMaterial')
material.node_tree.links.new(emission.outputs[0], surface.inputs['Surface'])
C = Matrix.Rotation(-math.pi / 2, 4, 'X')

def matrix(m):
    return [m[r][c] for c in range(4) for r in range(4)]

results = []
for kind in ['dolly', 'crane', '2d']:
    addon.build_rigs.build_camera_rig(bpy.context, kind.upper())
    rig = bpy.context.active_object
    cam = next(obj for obj in rig.children if obj.type == 'CAMERA')
    scene.camera = cam
    camera_bone = rig.pose.bones['Camera']
    if kind != '2d':
        camera_bone['lens'] = 120.0
        camera_bone['focus_distance'] = 4.0
        cam.data.dof.focus_object = None
    for projection in ['perspective', 'orthographic']:
        cam.data.type = 'PERSP' if projection == 'perspective' else 'ORTHO'
        cam.data.ortho_scale = 3.0
        if kind == '2d':
            camera_bone['rotation_shift'] = float(projection == 'orthographic')
        for fstop in [1.4, 8.0]:
            camera_bone['aperture_fstop'] = fstop
            rig.update_tag()
            cam.data.update_tag()
            bpy.context.view_layer.update()
            graph = bpy.context.evaluated_depsgraph_get()
            evaluated = cam.evaluated_get(graph)
            focus = evaluated.data.dof.focus_distance
            if evaluated.data.dof.focus_object:
                erig = rig.evaluated_get(graph)
                target = erig.matrix_world @ erig.pose.bones[evaluated.data.dof.focus_subtarget].matrix.translation
                focus = abs((evaluated.matrix_world.translation - target).dot(evaluated.matrix_world.col[2].to_3d().normalized()))
            width, height = 320, 180
            scene.render.resolution_x, scene.render.resolution_y = width, height
            projection_matrix = evaluated.calc_matrix_camera(graph, x=width, y=height)
            inverse = projection_matrix.inverted()
            optical = evaluated.matrix_world.normalized()
            objects, cards = [], []
            for depth in [focus * .25, focus, focus * 3]:
                points = []
                for x, y in [(-3, -3), (0, -3), (0, 3), (-3, 3)]:
                    p = inverse @ Vector((x, y, 0, 1))
                    p /= p.w
                    if projection == 'perspective':
                        p *= depth / -p.z
                    else:
                        p.z = -depth
                    points.append(optical @ p.to_3d())
                mesh = bpy.data.meshes.new('DOF reference edge')
                mesh.from_pydata(points, [], [(0, 1, 2), (0, 2, 3)])
                mesh.materials.append(material)
                obj = bpy.data.objects.new('DOF reference edge', mesh)
                scene.collection.objects.link(obj)
                objects.append(obj)
                # Cycles camera.cpp uses a unit focal length for orthographic aperture.
                # Its parallel rays converge from the aperture onto the focus plane.
                aperture_radius = (evaluated.data.lens / 1000 if projection == 'perspective' else 1) / (2 * fstop)
                radius = aperture_radius * projection_matrix[0][0] * width / 2
                radius *= abs(1 / depth - 1 / focus) if projection == 'perspective' else abs(1 - depth / focus)
                cards.append(dict(depth=depth, row=height // 2, cocRadius=radius,
                                  vertices=[list(C @ p) for p in points], indices=[0, 1, 2, 0, 2, 3]))
            name = f'{kind}-{projection}-f{fstop}'
            for index, card in enumerate(cards):
                card['images'] = {}
                for j, obj in enumerate(objects):
                    obj.hide_render = index != j
                for enabled in [False, True]:
                    cam.data.dof.use_dof = enabled
                    suffix = 'dof' if enabled else 'sharp'
                    path = OUTPUT / f'{name}-{index}-{suffix}.png'
                    scene.render.filepath = str(path)
                    bpy.ops.render.render(write_still=True)
                    card['images'][suffix] = str(path.relative_to(ROOT))
            bones = {p.name: dict(location=list(p.location), rotation=list(p.rotation_euler), scale=list(p.scale),
                                 properties={k: float(v) for k, v in p.items() if isinstance(v, (int, float)) and k != 'lens_without_breathing'})
                     for p in rig.pose.bones if not p.name.startswith('MCH-')}
            results.append(dict(name=name, type=kind, projection=projection, width=width, height=height,
                                focalLength=evaluated.data.lens, sensorWidth=evaluated.data.sensor_width,
                                focusDistance=focus, aperture=fstop, cards=cards,
                                cameraMatrix=matrix(C @ optical), projectionMatrix=matrix(projection_matrix),
                                request=dict(type=kind, bones=bones, aspect=width / height, projection=projection,
                                             orthographicHeight=evaluated.data.ortho_scale / (width / height),
                                             tracking=1, focusOnAim=False, focusBone='DOF' if kind == '2d' else None)))
            for obj in objects:
                mesh = obj.data
                bpy.data.objects.remove(obj, do_unlink=True)
                bpy.data.meshes.remove(mesh)
            (OUTPUT / 'oracle.json').write_text(json.dumps(results, separators=(',', ':')))
            print('DOF_RENDERED', name, flush=True)
print('Rendered', len(results) * 3, 'native source-rig DOF/sharp pairs', flush=True)
