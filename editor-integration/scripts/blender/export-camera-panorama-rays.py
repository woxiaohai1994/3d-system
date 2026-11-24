# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent native calls to the unchanged v4.3 camera_sample_panorama body."""
from pathlib import Path
import hashlib
import itertools
import json
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[2]
source = json.loads((ROOT / 'packages/viewer/src/lib/blender-camera-panorama-source.json').read_text())
projection = json.loads((ROOT / 'tests/integration/fixtures/blender-camera-panorama.json').read_text())
binary = ROOT / '.integration-audit/camera-panorama/panorama-reference'
defaults = source['defaults']
ray_defaults = source['rayDefaults']

def f32(value):
    return struct.unpack('f', struct.pack('f', value))[0]

def run(lines):
    output = subprocess.check_output([str(binary)], input='\n'.join(lines)+'\n', text=True)
    return [json.loads(line) for line in output.splitlines()]

def packed(p):
    p = defaults | p
    return [source['panoramaTypes'][p['panoramaType']], p['fisheyeFov'],p['fisheyeLens'],
            p['latitudeMin'],p['latitudeMax'],p['longitudeMin'],p['longitudeMax'],
            *p['fisheyePolynomial'],p['centralCylindricalRangeUMin'],p['centralCylindricalRangeUMax'],
            p['centralCylindricalRangeVMin'],p['centralCylindricalRangeVMax'],p['centralCylindricalRadius'],
            p['sensorWidth'],p['sensorHeight'],['AUTO','HORIZONTAL','VERTICAL'].index(p['sensorFit']),
            p['width'],p['height'],*p['pixelAspect'],*p['shift']]

variants = [
    {},
    dict(useDof=True, lens=85, apertureFstop=1.4, focusDistance=3, clipStart=.3, clipEnd=30),
    dict(useDof=True, lens=35, apertureFstop=4.2, focusDistance=5, apertureBlades=7,
         apertureRotation=.7, apertureRatio=2.3, shift=[.13,-.07], pixelAspect=[1.2,.7]),
    dict(useDof=True, apertureFstop=0, focusDistance=0, apertureBlades=2, apertureRatio=.5,
         clipStart=0.00001,clipEnd=10000),
    dict(useDof=False, apertureBlades=9, apertureRotation=.9, apertureRatio=3,
         clipStart=100000,clipEnd=100000.01),
    dict(clipStart=1,clipEnd=1),
    dict(clipStart=3,clipEnd=1),
    dict(clipEnd=f32(3.4028234663852886e38)),
]
worlds = [projection['matrices'][i]['bodyMatrix'] for i in range(3)]
samples = [
    ([.5,.5],[.5,.5]),([.27,.39],[0,0]),([.72,.61],[1,1]),
    ([.5,0],[.21,.79]),([0,.5],[.79,.21]),([1,.5],[.4,.6]),
    ([0,0],[.61,.73]),([1.1,.7],[.2,.9]),
]
cases, lines = [], []
for kind,world,variant in itertools.product(source['panoramaTypes'],worlds,variants):
    parameters = dict(panoramaType=kind, width=1920, height=1080) | variant
    p = packed(parameters)
    settings = run(['C '+' '.join(map(str,p))])[0]
    camera_world = run(['M '+str(p[0])+' '+' '.join(map(str,world))])[0]
    r = {key:f32(value) if isinstance(value,(float,int)) else value
         for key,value in (ray_defaults | parameters).items()}
    if r['useDof']:
        radius=f32(f32(r['lens']*f32(.001))/f32(2*max(r['apertureFstop'],f32(1e-5))))
        focus=max(r['focusDistance'],f32(1e-5))
        blades=0 if r['apertureBlades']<3 else r['apertureBlades']
        rotation=r['apertureRotation']
        ratio=f32(1/r['apertureRatio'])
    else:
        radius,focus,blades,rotation,ratio=0,f32(1e-5),0,0,1
    near=r['clipStart'];far=r['clipEnd']
    length=far if far==f32(3.4028234663852886e38) else f32(far-near)
    kernel=[p[0],p[1],p[2],*settings[0:2],*settings[6:10],*p[7:12],*settings[10:14],
            radius,focus,blades,rotation,ratio,near,length,*camera_world,*settings[2:6],p[20],p[21]]
    case=dict(parameters=parameters,bodyMatrix=world,samples=[])
    for uv,lens_uv in samples:
        lines.append('Q '+' '.join(map(str,kernel+uv+lens_uv)))
        case['samples'].append(dict(uv=uv,lensUV=lens_uv))
    cases.append(case)
values=iter(run(lines))
nonfinite=outside=0
for case in cases:
    for sample in case['samples']:
        value=next(values)
        sample['expected']=value
        sample['valid']=None not in value and value[7]>0
        if None in value: nonfinite+=1
        elif value[7]<=0: outside+=1
result=dict(source=source['source'],hashes=source['hashes'],
            oracleHash=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            sampler='camera_sample_panorama',cases=cases)
(ROOT / 'tests/integration/fixtures/blender-camera-panorama-rays.json').write_text(
    json.dumps(result,separators=(',',':'))+'\n')
print(f'Native unchanged sampler: {len(cases)} cameras, {len(lines)} rays, {nonfinite} nonfinite, {outside} outside/clip invalid')
