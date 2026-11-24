# SPDX-License-Identifier: GPL-3.0-or-later
"""Capture multi-bone transforms by running the original add-on in Blender."""
import bpy, importlib.util, json, math, sys
from pathlib import Path
from mathutils import Matrix, Vector
ROOT = Path(__file__).resolve().parents[2]
source = ROOT / 'vendor/add-camera-rigs'
spec = importlib.util.spec_from_file_location('add_camera_rigs', source/'__init__.py', submodule_search_locations=[str(source)])
addon = importlib.util.module_from_spec(spec); sys.modules[spec.name] = addon
spec.loader.exec_module(addon); addon.register()
bpy.context.preferences.addons.new().module = 'add_camera_rigs'
C = Matrix.Rotation(-math.pi / 2, 4, 'X')
flat = lambda m: [m[r][c] for c in range(4) for r in range(4)]
def state(rig, names):
    return {p.name: dict(location=list(p.location), rotation=list(p.rotation_euler), scale=list(p.scale), properties={k:p[k] for k in p.keys() if isinstance(p[k],(float,int))}) for p in rig.pose.bones if p.name in names}
cases = []
for kind in ['DOLLY', 'CRANE', '2D']:
    if bpy.context.object and bpy.context.object.mode != 'OBJECT': bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT'); addon.build_rigs.build_camera_rig(bpy.context, kind)
    rig = bpy.context.object
    assert not any(b.use_connect for b in rig.data.bones), 'adapter requires disconnected source controls'
    names = [p.name for p in rig.pose.bones if p.custom_shape or p.name in ['Crane_Height','Crane_Arm']]
    bpy.ops.object.mode_set(mode='POSE')
    pairs = [['Camera','Aim'], ['Root','Camera'], ['Camera','Camera_Offset']] if kind != '2D' else [['Camera','Aim'], ['Root','Camera'], ['Aim','Left_Corner'], ['Left_Corner','Right_Corner']]
    if kind == 'CRANE': pairs += [['Crane_Height','Crane_Arm'], ['Crane_Arm','Camera']]
    selections = [(selected, selected[-1]) for selected in pairs]
    selections += [([name], 'Aim' if name != 'Aim' else 'Camera') for name in names]
    for selected, active in selections:
      for pivot in ['MEDIAN_POINT','BOUNDING_BOX_CENTER','ACTIVE_ELEMENT','INDIVIDUAL_ORIGINS','CURSOR']:
       for mode in ['translate','rotate','scale']:
        for variant in ['rest','posed']:
         for p in rig.pose.bones:
            p.matrix_basis = Matrix.Identity(4); p.select = p.name in selected
         rig.matrix_world = Matrix.Identity(4)
         if variant == 'posed':
            rig.rotation_euler = (.2,.4,-.3); rig.scale = (1.3,.8,1.1)
            rig.pose.bones['Root'].rotation_euler = (.2,-.15,.3)
            rig.pose.bones['Root'].scale = (1.2,.7,1.1)
         rig.data.bones.active = rig.data.bones[active]
         bpy.context.scene.cursor.location = C.inverted() @ Vector((.4,2,-3))
         bpy.context.scene.tool_settings.transform_pivot_point = pivot
         bpy.context.view_layer.update()
         before = state(rig,names); placement = flat(C @ rig.matrix_world @ C.inverted())
         area = next(a for a in bpy.context.screen.areas if a.type == 'VIEW_3D')
         region = next(r for r in area.regions if r.type == 'WINDOW')
         with bpy.context.temp_override(area=area,region=region):
            if mode == 'translate': bpy.ops.transform.translate(value=(.7,-.2,-.3),orient_type='GLOBAL')
            elif mode == 'rotate': bpy.ops.transform.rotate(value=.4,orient_axis='Z',orient_type='GLOBAL',constraint_axis=(False,False,True))
            else: bpy.ops.transform.resize(value=(1.2,1.4,.8),orient_type='GLOBAL')
         bpy.context.view_layer.update()
         cases.append(dict(type={'DOLLY':'dolly','CRANE':'crane','2D':'2d'}[kind],selected=selected,active=active,pivot=pivot,mode=mode,variant=variant,placement=placement,before=before,after=state(rig,names)))
(ROOT/'tests/integration/fixtures/add-camera-rigs-selection.json').write_text(json.dumps(dict(blender=bpy.app.version_string,cases=cases),separators=(',',':'))+'\n')
print('Exported',len(cases),'native multi-bone transforms')
