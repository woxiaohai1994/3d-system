# SPDX-License-Identifier: GPL-3.0-or-later
"""Development oracle: render the original addon, never used by the application."""
import copy
import json
from pathlib import Path
import runpy

import bpy
from mathutils import Euler, Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
oracle = runpy.run_path(str(Path(__file__).with_name('export-camera-rigs.py')))
output = ROOT / '.integration-audit/camera-rigs-render'
output.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 8
scene.cycles.use_denoising = False
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
for obj in bpy.data.objects:
    if obj.type == 'MESH':
        obj.hide_render = True

cards = [(-.55, -.4, .32, .3, 4, (1, 0, 0)), (.4, -.25, .35, .4, 7, (0, 1, 0)),
         (-.15, .45, .55, .25, 11, (0, 0, 1)), (.55, .5, .15, .18, 5, (1, 1, 0))]
results, parent_cases = [], []
for kind in ['dolly', 'crane', '2d']:
    for variant in ['default', 'shear', 'mirror', 'scene-parent', 'scene-mirror', 'scene-combined', 'scene-optics']:
        for projection in ['perspective', 'orthographic']:
            bones = copy.deepcopy(oracle['rigs'][kind][2])
            if variant in ['shear', 'mirror', 'scene-combined']:
                bones['Root'].update(scale=[-2 if variant == 'mirror' else 2, .7, 1.4], rotation=[.3, .5, .8])
                bones['Camera'].update(rotation=[.2, -.3, .6])
                bones['Aim'].update(location=[2, -1, 3])
            aspect = 9 / 16 if projection == 'orthographic' else 16 / 9
            request = dict(type=kind, bones=bones, aspect=aspect, projection=projection, tracking=.75, focusOnAim=True)
            if variant == 'scene-optics':
                request['focusBone'] = 'DOF' if kind == '2d' else 'Aim'
                bones['Aim']['location'] = [2, -1, 3]
                if kind != '2d':
                    bones['Camera']['properties'].update(lens=70, lens_breathing_scale=.3, lens_offset=5)
                    request['dollyDistance'] = 7.5
            rig, cam, _ = oracle['rigs'][kind]
            parent = None
            if variant.startswith('scene-'):
                parent = bpy.data.objects.new('ParityParent', None)
                scene.collection.objects.link(parent)
                parent.matrix_world = Matrix.LocRotScale(Vector((3,-2,1)), Euler((.2,-.5,.4)).to_quaternion(), Vector((-2 if variant == 'scene-mirror' else 2,.7,1.4)))
                rig.parent = parent
            result = oracle['evaluate'](request)
            if parent:
                parent_matrix = oracle['matrix'](oracle['C'] @ parent.matrix_world @ oracle['C'].inverted())
                parent_cases.append(dict(name=f'{kind}-{variant}-{projection}', request=dict(request,worldMatrix=parent_matrix), expected=result))
            cam.data.dof.use_dof = False
            width, height = (180, 320) if aspect < 1 else (320, 180)
            scene.render.resolution_x, scene.render.resolution_y = width, height
            graph = bpy.context.evaluated_depsgraph_get()
            ecam = cam.evaluated_get(graph)
            optical = ecam.matrix_world.normalized()
            projection_matrix = ecam.calc_matrix_camera(graph, x=width, y=height)
            inverse = projection_matrix.inverted()
            meshes, objects = [], []
            for index, (x, y, w, h, depth, rgb) in enumerate(cards):
                points = []
                for sx, sy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
                    p = inverse @ Vector((x + sx*w/2, y + sy*h/2, 0, 1))
                    p /= p.w
                    if projection == 'perspective':
                        p *= depth / -p.z
                    else:
                        p.z = -depth
                    points.append(optical @ p.to_3d())
                mesh = bpy.data.meshes.new('ParityCard')
                mesh.from_pydata(points, [], [(0, 1, 2), (0, 2, 3)])
                obj = bpy.data.objects.new('ParityCard', mesh)
                scene.collection.objects.link(obj)
                material = bpy.data.materials.new('ParityEmission')
                material.use_nodes = True
                nodes = material.node_tree.nodes
                nodes.clear()
                emission = nodes.new('ShaderNodeEmission')
                emission.inputs['Color'].default_value = (*rgb, 1)
                surface = nodes.new('ShaderNodeOutputMaterial')
                material.node_tree.links.new(emission.outputs[0], surface.inputs['Surface'])
                mesh.materials.append(material)
                objects.append(obj)
                meshes.append(dict(vertices=[list(oracle['C'] @ p) for p in points], indices=[0,1,2,0,2,3], color=rgb))
            name = f'{kind}-{variant}-{projection}'
            scene.render.filepath = str(output / f'{name}-blender.png')
            bpy.ops.render.render(write_still=True)
            results.append(dict(name=name, request=request, width=width, height=height, meshes=meshes,
                                parentMatrix=oracle['matrix'](oracle['C'] @ parent.matrix_world @ oracle['C'].inverted()) if parent else None,
                                cameraMatrix=result['cameraMatrix'], projectionMatrix=result['projectionMatrix']))
            for obj in objects:
                bpy.data.objects.remove(obj, do_unlink=True)
            if parent:
                rig.parent = None
                bpy.data.objects.remove(parent, do_unlink=True)
            print('RENDERED', name, flush=True)
(output / 'oracle.json').write_text(json.dumps(results, separators=(',', ':')))
(ROOT / 'tests/integration/fixtures/add-camera-rigs-parents.json').write_text(json.dumps(parent_cases, separators=(',', ':')))
print('Rendered', len(results), 'original-addon camera cases')
