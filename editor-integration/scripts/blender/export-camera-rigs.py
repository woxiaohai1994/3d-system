# SPDX-License-Identifier: GPL-3.0-or-later
"""Development-only: extract upstream rig definitions and Blender parity fixtures."""
import bpy
import importlib.util
import json
import math
from pathlib import Path
import sys
import traceback
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor' / 'add-camera-rigs'
spec = importlib.util.spec_from_file_location('add_camera_rigs', SOURCE / '__init__.py', submodule_search_locations=[str(SOURCE)])
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
bpy.context.preferences.addons.new().module = 'add_camera_rigs'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
C = Matrix.Rotation(-math.pi / 2, 4, 'X')
rigs = {}

def matrix(m):
    return [m[r][c] for c in range(4) for r in range(4)]

def controls(rig):
    return [p for p in rig.pose.bones if not p.name.startswith('MCH-')]

def state(rig):
    return {p.name: {'location': list(p.location), 'rotation': list(p.rotation_euler), 'scale': list(p.scale), 'properties': {k: float(v) for k,v in p.items() if isinstance(v,(int,float)) and k != 'lens_without_breathing'}} for p in controls(rig)}

for kind in ['dolly','crane','2d']:
    addon.build_rigs.build_camera_rig(bpy.context, kind.upper())
    rig = bpy.context.active_object
    cam = next(o for o in rig.children if o.type == 'CAMERA')
    bpy.context.view_layer.update()
    rigs[kind] = (rig, cam, state(rig))

def evaluate(request):
    kind = request['type']
    rig,cam,defaults = rigs[kind]
    bpy.context.view_layer.objects.active = rig
    bpy.context.scene.camera = cam
    for p in rig.pose.bones:
        p.matrix_basis = Matrix.Identity(4)
    values = request.get('bones') or defaults
    for name, values in values.items():
        if name not in defaults:
            raise ValueError('Unknown control: ' + name)
        p = rig.pose.bones[name]
        p.location = values['location']
        p.rotation_euler = values['rotation']
        p.scale = values['scale']
        for key,value in defaults[name]['properties'].items():
            p[key] = float(request.get('bones',defaults).get(name,{}).get('properties',{}).get(key,value))
    aspect = request.get('aspect',16/9)
    bpy.context.scene.render.resolution_x = round(1440*aspect)
    bpy.context.scene.render.resolution_y = 1440
    cam.data.type = 'ORTHO' if request.get('projection') == 'orthographic' else 'PERSP'
    cam.data.sensor_width = request.get('sensorWidth',36)
    cam.data.ortho_scale = request.get('orthographicHeight',20)*max(1,aspect)
    cam.data.dof.focus_object = None
    if request.get('focusOnAim') or kind == '2d':
        cam.data.dof.focus_object = rig
        cam.data.dof.focus_subtarget = 'DOF' if kind == '2d' else 'Aim'
    # Apply the intended focus callback to its actual camera lens driver. Raw
    # upstream requests retain its original manual-distance driver behavior.
    focus_var = next((v for f in (cam.data.animation_data.drivers if cam.data.animation_data else []) if f.data_path == 'lens' for v in f.driver.variables if v.name == 'focus_distance'), None)
    if focus_var:
        focus_var.type = 'SINGLE_PROP'
        focus_var.targets[0].id_type = 'OBJECT'
        focus_var.targets[0].id = rig
        focus_var.targets[0].data_path = 'pose.bones["Camera"]["focus_distance"]'
    if 'focusBone' in request:
        cam.data.dof.focus_object = None
        cam.data.dof.focus_subtarget = ''
        if request.get('focusTarget') is not None:
            target = bpy.data.objects.get('NativeFocusOracle')
            if target is None:
                target = bpy.data.objects.new('NativeFocusOracle', None)
                bpy.context.scene.collection.objects.link(target)
            target.location = C.inverted() @ Vector(request['focusTarget'])
            cam.data.dof.focus_object = target
        elif request.get('focusBone'):
            cam.data.dof.focus_object = rig
            cam.data.dof.focus_subtarget = request['focusBone']
        if focus_var and cam.data.dof.focus_object:
            focus_var.type = 'LOC_DIFF'
            focus_var.targets[0].id = rig
            focus_var.targets[0].bone_target = 'Camera'
            focus_var.targets[1].id = cam.data.dof.focus_object
            focus_var.targets[1].bone_target = cam.data.dof.focus_subtarget
    if kind != '2d':
        rig.pose.bones['Camera'].constraints[0].influence = request.get('tracking',1)
        driver = next(d.driver for d in rig.animation_data.drivers if 'lens_without_breathing' in d.data_path)
        driver.expression = addon.operators.get_lens_expr(request.get('dollyDistance'))
    elif cam.data.type == 'ORTHO':
        rig.pose.bones['Camera']['rotation_shift'] = 1.0
    if kind=='2d': rig.pose.bones['MCH-DOF_Parent'].constraints[0].influence=request.get('dofTracking',1)
    rig.update_tag()
    cam.data.update_tag()
    bpy.context.view_layer.update()
    if request.get('target') is not None:
        aim = rig.pose.bones['Aim']
        m = aim.matrix.copy()
        m.translation = C.inverted() @ Vector(request['target'])
        aim.matrix = m
        bpy.context.view_layer.update()
    operation = request.get('operation')
    if operation:
        allowed = {'shift_to_pivot','set_dolly_zoom','remove_dolly_zoom','set_dof_bone','swap_lens'}
        if operation not in allowed:
            raise ValueError('Unsupported operation')
        kwargs = {'camera_lens':request['lens']} if operation == 'swap_lens' else {}
        result = getattr(bpy.ops.add_camera_rigs,operation)(**kwargs)
        if result != {'FINISHED'}: raise RuntimeError('Plugin operator failed')
        rig.update_tag();cam.data.update_tag();bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    erig = rig.evaluated_get(graph)
    ecam = cam.evaluated_get(graph)
    cam_matrix = C @ ecam.matrix_world
    projection = ecam.calc_matrix_camera(graph,x=round(1440*aspect),y=1440,scale_x=1,scale_y=1)
    widgets = []
    for p in controls(rig):
        ep = erig.pose.bones[p.name]
        transform = p.custom_shape_transform
        shape_matrix = erig.pose.bones[transform.name].matrix if transform else ep.matrix
        if p.custom_shape:
            scale = p.custom_shape_scale_xyz * (p.bone.length if p.use_custom_shape_bone_size else 1)
            shape_matrix = C @ erig.matrix_world @ shape_matrix @ Matrix.LocRotScale(p.custom_shape_translation,p.custom_shape_rotation_euler.to_quaternion(),scale)
            vertices = [list(v.co) for v in p.custom_shape.data.vertices]
            edges = [list(e.vertices) for e in p.custom_shape.data.edges]
        else:
            # Blender's BBONE display for Crane_Height / Crane_Arm, sized by the original bone.
            x,z = p.bone.bbone_x,p.bone.bbone_z
            vertices = [[a*x,y*p.bone.length,b*z] for y in [0,1] for a,b in [(-1,-1),(1,-1),(1,1),(-1,1)]]
            edges = [[i,i//4*4+(i+1)%4] for i in range(8)]+[[i,i+4] for i in range(4)]
            shape_matrix = C @ erig.matrix_world @ ep.matrix
        parent_args = {'parent_matrix':erig.pose.bones[p.parent.name].matrix, 'parent_matrix_local':p.parent.bone.matrix_local} if p.parent else {}
        edit = p.bone.convert_local_to_pose(Matrix.Identity(4),p.bone.matrix_local,**parent_args)
        location_matrix = Matrix.Identity(4)
        location_matrix.translation = edit.translation
        for axis in range(3):
            local = Vector((0,0,0)); local[axis] = 1
            delta = p.bone.convert_local_to_pose(Matrix.Translation(local),p.bone.matrix_local,**parent_args).translation - edit.translation
            for row in range(3): location_matrix[row][axis] = delta[row]
        widgets.append({'name':p.name,'parent':p.parent.name if p.parent else None,'matrix':matrix(shape_matrix),'boneMatrix':matrix(C @ erig.matrix_world @ ep.matrix),'editMatrix':matrix(C @ erig.matrix_world @ edit),'locationMatrix':matrix(C @ erig.matrix_world @ location_matrix),'vertices':vertices,'edges':edges,**({'display':{'type':'bbone','size':[p.bone.bbone_x,p.bone.length,p.bone.bbone_z]}} if not p.custom_shape else {}),'locks':{'location':list(p.lock_location),'rotation':list(p.lock_rotation),'scale':list(p.lock_scale)},'properties':{k:dict(p.id_properties_ui(k).as_dict()) for k in defaults[p.name]['properties']}})
    focus = ecam.data.dof.focus_distance
    if ecam.data.dof.focus_object:
        target = erig.matrix_world @ erig.pose.bones[ecam.data.dof.focus_subtarget].matrix.translation if ecam.data.dof.focus_subtarget else ecam.data.dof.focus_object.matrix_world.translation
        # BKE_camera_object_dof_distance: axial focus depth, unlike LOC_DIFF lens breathing.
        focus = abs((ecam.matrix_world.translation - target).dot(ecam.matrix_world.col[2].to_3d().normalized()))
    focus = max(1e-5, focus)
    return {'aspect':aspect,'type':kind,'bones':state(rig),'widgets':widgets,'cameraMatrix':matrix(cam_matrix),'projectionMatrix':matrix(projection),'lens':ecam.data.lens,'focusDistance':focus,'aperture':ecam.data.dof.aperture_fstop,'dollyDistance':addon.operators.calculate_aim_distance(rig),'sourceVersion':'1.9.0','blenderVersion':bpy.app.version_string}


def drivers(owner):
    if not owner.animation_data: return []
    return [{'path':f.data_path,'index':f.array_index,'expression':f.driver.expression,'variables':[{'name':v.name,'type':v.type,'targets':[{'bone':t.bone_target,'path':t.data_path,'transform':t.transform_type,'space':t.transform_space} for t in v.targets]} for v in f.driver.variables]} for f in owner.animation_data.drivers]

catalog={}
for kind,(rig,cam,defaults) in rigs.items():
    result=evaluate({'type':kind})
    bones=[]
    for p in rig.pose.bones:
        bones.append({'name':p.name,'parent':p.parent.name if p.parent else None,'rest':matrix(p.bone.matrix_local),'length':p.bone.length,'inheritScale':p.bone.inherit_scale,'inheritRotation':p.bone.use_inherit_rotation,'widgetTransform':p.custom_shape_transform.name if p.custom_shape_transform else None,'widgetOffset':matrix(Matrix.LocRotScale(p.custom_shape_translation,p.custom_shape_rotation_euler.to_quaternion(),p.custom_shape_scale_xyz*(p.bone.length if p.use_custom_shape_bone_size else 1))) if p.custom_shape else matrix(Matrix.Identity(4)),'constraints':[{'type':c.type,'target':c.subtarget,'influence':c.influence,'track':getattr(c,'track_axis',None),'up':getattr(c,'up_axis',None),'targetZ':getattr(c,'use_target_z',False),'ownerSpace':c.owner_space,'targetSpace':c.target_space} for c in p.constraints]})
    catalog[kind]={'bones':bones,'defaults':defaults,'widgets':result['widgets'],'drivers':drivers(rig),'cameraDrivers':drivers(cam.data),'cameraParent':cam.parent_bone,'cameraLocal':matrix(cam.matrix_local),'cameraBasis':matrix(cam.matrix_basis),'sensorFit':cam.data.sensor_fit,'reference':result}
output=ROOT/'packages/viewer/src/lib/add-camera-rigs-source.ts'
output.write_text('// SPDX-License-Identifier: GPL-3.0-or-later\n// Generated from vendored Add Camera Rigs 1.9.0; run scripts/blender/export-camera-rigs.py.\nimport type { RigSource } from \'./add-camera-rigs-runtime\'\nexport const cameraRigsSource = '+json.dumps(catalog,separators=(',',':'))+' as unknown as Record<\'dolly\' | \'crane\' | \'2d\', RigSource>\n')

import copy
fixtures=[]
for kind,(_,_,defaults) in rigs.items():
    cases=[{}, {'Root':{'location':[2,3,-1],'rotation':[.15,-.2,.4],'scale':[1.3,1.3,1.3]}}, {'Aim':{'location':[2,1,3],'rotation':[.2,.4,-.1]}}, {'Camera':{'location':[1,-2,.5]}}]
    if kind!='2d': cases += [{'Root':{'scale':[2,.7,1.4],'rotation':[.3,.5,.8]},'Camera':{'rotation':[.2,-.3,.6]},'Aim':{'location':[2,-1,3]}}, {'Camera':{'scale':[2,.7,1.4],'rotation':[.3,.5,.8]},'Camera_Offset':{'location':[.1,.2,.3],'rotation':[.2,.3,.4]}}]
    if kind=='crane': cases += [{'Crane_Height':{'scale':[1,2,1]},'Crane_Arm':{'rotation':[.4,0,.7],'scale':[1,3,1]}}, {'Camera_Offset':{'location':[.3,-.5,.2],'rotation':[.1,.2,.3]}}]
    if kind=='2d': cases += [{'Root_Offset':{'location':[1,0,0],'rotation':[.1,.2,.3]},'Root_Tweak':{'location':[0,.5,0],'rotation':[.05,0,0]}}, {'Left_Corner':{'location':[-1,.5,.2]},'Right_Corner':{'location':[2,.5,.2]},'Camera':{'properties':{'rotation_shift':1}}}, {'DOF':{'location':[0,0,3]}}]
    cases += [{'Root':{'scale':[-2,.7,1.4],'rotation':[.3,.5,.8]},'Camera':{'rotation':[.2,-.3,.6]},'Aim':{'location':[2,-1,3]}}]
    if kind=='crane': cases += [{'Root':{'scale':[2,.7,1.4],'rotation':[.3,.5,.8]},'Camera':{'location':[1,-2,.5],'rotation':[.2,-.3,.6]},'Crane_Height':{'scale':[1,2,1]},'Crane_Arm':{'scale':[1,3,1],'rotation':[.4,0,.7]}}]
    if kind=='2d': cases += [{'Root':{'scale':[2,.7,1.4],'rotation':[.3,.5,.8]},'Camera':{'location':[1,-2,.5],'rotation':[.2,-.3,.6]}}]
    for changes in cases:
        bones=copy.deepcopy(defaults)
        for name,fields in changes.items():
            for key,value in fields.items():
                if key=='properties':bones[name][key].update(value)
                else:bones[name][key]=value
        for aspect in [16/9,9/16]:
            for projection in ['perspective','orthographic']:
                request={'type':kind,'bones':bones,'aspect':aspect,'projection':projection,'tracking':.75,'focusOnAim':True}
                result=evaluate(request)
                fixtures.append({'request':request,'expected':{k:result[k] for k in ['cameraMatrix','projectionMatrix','lens','focusDistance','dollyDistance']},'controls':{w['name']:{k:w[k] for k in ['matrix','boneMatrix','editMatrix','locationMatrix']} for w in result['widgets']}})
for kind,(_,_,defaults) in rigs.items():
    for mode in ['pivot', 'target', 'lens', 'dolly']:
        if mode=='dolly' and kind=='2d': continue
        bones=copy.deepcopy(defaults)
        bones['Camera']['location']=[1,-2,.5]
        bones['Aim']['location']=[2,1,3]
        if kind!='2d': bones['Camera']['properties'].update({'lens':70,'lens_breathing_scale':.3,'lens_offset':5,'focus_distance':8})
        request={'type':kind,'bones':bones,'aspect':16/9,'projection':'perspective','tracking':1,'focusOnAim':False}
        if mode=='pivot': request['operation']='shift_to_pivot'
        if mode=='target': request['target']=[3,2,-5]
        if mode=='dolly': request['dollyDistance']=7.5
        result=evaluate(request)
        fixtures.append({'request':request,'expected':{k:result[k] for k in ['cameraMatrix','projectionMatrix','lens','focusDistance','dollyDistance']},'controls':{w['name']:{k:w[k] for k in ['matrix','boneMatrix','editMatrix','locationMatrix']} for w in result['widgets']}})
for influence in [0,.25,.5,1]:
    bones=copy.deepcopy(rigs['2d'][2])
    bones['Aim']['location']=[2,3,4]
    bones['DOF']['location']=[1,2,3]
    request={'type':'2d','bones':bones,'dofTracking':influence,'focusOnAim':True,'aspect':16/9,'projection':'perspective'}
    result=evaluate(request)
    fixtures.append({'request':request,'expected':{k:result[k] for k in ['cameraMatrix','projectionMatrix','lens','focusDistance','dollyDistance']},'controls':{w['name']:{k:w[k] for k in ['matrix','boneMatrix','editMatrix','locationMatrix']} for w in result['widgets']}})
for kind,(_,_,defaults) in rigs.items():
    for focus in [dict(focusBone=None),dict(focusBone='Aim'),dict(focusBone='DOF' if kind=='2d' else 'Root'),dict(focusBone=None,focusTarget=[3,2,-6])]:
        bones=copy.deepcopy(defaults)
        bones['Camera']['location']=[1,-2,.5]
        bones['Camera']['properties']['focus_distance']=8
        if 'lens_breathing_scale' in bones['Camera']['properties']: bones['Camera']['properties']['lens_breathing_scale']=.3
        for aspect in [16/9,9/16]:
            request=dict(type=kind,bones=bones,aspect=aspect,projection='perspective',**focus)
            result=evaluate(request)
            fixtures.append({'request':request,'expected':{k:result[k] for k in ['cameraMatrix','projectionMatrix','lens','focusDistance','dollyDistance']},'controls':{w['name']:{k:w[k] for k in ['matrix','boneMatrix','editMatrix','locationMatrix']} for w in result['widgets']}})
for fixture in fixtures:
    request=fixture['request']
    evaluate(request)
    graph=bpy.context.evaluated_depsgraph_get()
    camera=rigs[request['type']][1].evaluated_get(graph)
    projection=camera.calc_matrix_camera(graph,x=round(1440*request.get('aspect',16/9)),y=1440,scale_x=1,scale_y=1)
    view=camera.matrix_world.normalized().inverted()
    points=[]
    for local in [(-1,-.5,-4),(.1,.3,-8),(2,.1,-12),(-3,2,-20)]:
        world=camera.matrix_world @ Vector(local)
        clip=projection @ view @ world.to_4d()
        points.append({'world':list(C @ world),'ndc':[clip[i]/clip.w for i in range(3)]})
    fixture['projectedPoints']=points
(ROOT/'tests/integration/fixtures/add-camera-rigs-parity.json').write_text(json.dumps(fixtures,separators=(',',':')))
print('Exported official controls and',len(fixtures),'Blender parity cases')
