# SPDX-License-Identifier: GPL-3.0-or-later
"""Native original-Cycles oracle; ray calls bypass the WASM adapter's configure/direction entry."""
from pathlib import Path
import hashlib
import itertools
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
source = json.loads((ROOT / 'packages/viewer/src/lib/blender-camera-panorama-source.json').read_text())
native = ROOT / '.integration-audit/camera-panorama/panorama-reference'
assert native.exists(), 'Run compile-camera-panorama.py first'
defaults = source['defaults']

def run(lines):
    output = subprocess.check_output([str(native)], input='\n'.join(lines)+'\n', text=True)
    values = [json.loads(line) for line in output.splitlines()]
    assert len(lines) == len(values)
    return values

def packed(p):
    p = defaults | p
    return [source['panoramaTypes'][p['panoramaType']], p['fisheyeFov'],p['fisheyeLens'],
            p['latitudeMin'],p['latitudeMax'],p['longitudeMin'],p['longitudeMax'],
            *p['fisheyePolynomial'],p['centralCylindricalRangeUMin'],p['centralCylindricalRangeUMax'],
            p['centralCylindricalRangeVMin'],p['centralCylindricalRangeVMax'],p['centralCylindricalRadius'],
            p['sensorWidth'],p['sensorHeight'],['AUTO','HORIZONTAL','VERTICAL'].index(p['sensorFit']),
            p['width'],p['height'],*p['pixelAspect'],*p['shift']]

parameters = []
for kind,fit,size,variant in itertools.product(source['panoramaTypes'],['AUTO','HORIZONTAL','VERTICAL'],
                                               [(1920,1080),(1080,1920),(1440,1440)],[0,1,2]):
    p = dict(panoramaType=kind,sensorFit=fit,width=size[0],height=size[1])
    if variant == 1:
        p.update(fisheyeLens=5,fisheyeFov=1.6,latitudeMin=-.7,latitudeMax=1.1,
                 longitudeMin=-2.3,longitudeMax=.8,shift=[.2,-.3],pixelAspect=[1.2,.7],
                 centralCylindricalRangeUMin=-2,centralCylindricalRangeUMax=.5,
                 centralCylindricalRangeVMin=-2,centralCylindricalRangeVMax=3,
                 centralCylindricalRadius=2.7,fisheyePolynomial=[.01,-.025,1e-5,-1e-6,1e-8])
    elif variant == 2:
        p.update(fisheyeLens=100,fisheyeFov=6.283185307179586,latitudeMin=.9,latitudeMax=-.6,
                 longitudeMin=2.5,longitudeMax=-1.2,shift=[-.7,.4],sensorWidth=50,sensorHeight=21,
                 centralCylindricalRangeUMin=1.5,centralCylindricalRangeUMax=-1.5,
                 centralCylindricalRangeVMin=4,centralCylindricalRangeVMax=-3,
                 centralCylindricalRadius=.4)
    parameters.append(p)
settings = run(['C '+' '.join(map(str,packed(p))) for p in parameters])
cases,ray_lines = [],[]
positions = [[-.2,.3],[0,0],[.25,.3],[.5,.5],[.75,.8],[1,1],[1.2,.5]]
directions = [[1,0,0],[0,1,0],[0,0,1],[-1,0,0],[.3,-.4,.5],[-.7,.2,.1],[0,0,-1]]
for p,settings_value in zip(parameters,settings):
    values = packed(p)
    kernel = [values[0],values[1],values[2],*settings_value[0:2],*settings_value[6:10],
              *values[7:12],*settings_value[10:14]]
    case = dict(parameters=p,settings=settings_value,samples=[])
    for uv,direction in zip(positions,directions):
        view= settings_value[2:6]
        shifted=[view[0]+(view[1]-view[0])*uv[0],view[2]+(view[3]-view[2])*uv[1]]
        ray_lines.append('R '+' '.join(map(str,kernel+shifted+direction)))
        case['samples'].append(dict(uv=uv,inputDirection=direction))
    cases.append(case)
expected = iter(run(ray_lines))
for case in cases:
    view = case['settings'][2:6]
    for sample in case['samples']:
        value = next(expected)
        sample['direction'] = (None if value['direction']==[0,0,0] or None in value['direction']
                               else value['direction'])
        uv = value['project']
        sample['project'] = (None if None in uv else [(uv[0]-view[0])/(view[1]-view[0]),
                                                     (uv[1]-view[2])/(view[3]-view[2])])

worlds=[
    [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
    [1.8,.7,-.2,0,-.4,.9,.3,0,.6,.2,1.3,0,2,-1,3,1],
    [-2,.3,0,0,.2,.7,-.1,0,.4,0,1.2,0,-3,2,.7,1],
    [0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
    [1,1,0,0,2,2,0,0,0,0,1,0,4,3,2,1],
]
matrices=[dict(panoramaType=kind,bodyMatrix=world) for kind,world
          in itertools.product(source['panoramaTypes'],worlds)]
matrix_values=run(['M '+str(source['panoramaTypes'][sample['panoramaType']])+' '+
                   ' '.join(map(str,sample['bodyMatrix'])) for sample in matrices])
for sample,value in zip(matrices,matrix_values): sample['expected']=value
result=dict(source=source['source'],hashes=source['hashes'],
            oracleHash=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),cases=cases,matrices=matrices)
target=ROOT/'tests/integration/fixtures/blender-camera-panorama.json'
target.write_text(json.dumps(result,separators=(',',':'))+'\n')
print(f'Native original Cycles: {len(cases)} camera settings, {len(ray_lines)} forward/inverse pairs, {len(matrices)} matrices')
