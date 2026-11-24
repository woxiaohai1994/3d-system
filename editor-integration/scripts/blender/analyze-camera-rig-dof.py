"""Measure linear-light edge spread in native Blender DOF reference images."""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / '.integration-audit/camera-rigs-dof'

def edge_width(path, row):
    rgb = np.asarray(Image.open(ROOT / path), dtype=float)[:, :, :3] / 255
    linear = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    profile = linear[row - 24:row + 24, :, 0].mean(axis=0)
    def crossing(level):
        candidates = np.flatnonzero((profile[:-1] >= level) & (profile[1:] < level))
        if not len(candidates):
            raise ValueError(f'Edge does not reach {level}: {path}')
        index = int(candidates[np.argmin(abs(candidates - len(profile) / 2))])
        return index + (profile[index] - level) / (profile[index] - profile[index + 1])
    return float(crossing(.1) - crossing(.9))

low, high = 0.0, 1.0
for _ in range(64):
    x = (low + high) / 2
    area = .5 + (math.asin(x) + x * math.sqrt(1 - x * x)) / math.pi
    if area < .9:
        low = x
    else:
        high = x
width_per_radius = low + high

measurements = []
cases = json.loads((OUTPUT / 'oracle.json').read_text())
for case in cases:
    for card in case['cards']:
        measured = edge_width(card['images']['dof'], card['row'])
        sharp = edge_width(card['images']['sharp'], card['row'])
        expected = card['cocRadius'] * width_per_radius
        measurements.append(dict(name=case['name'], depth=card['depth'], cocRadius=card['cocRadius'],
                                 expectedEdgeWidth=expected, measuredEdgeWidth=measured, sharpEdgeWidth=sharp,
                                 pixelError=abs(measured - expected)))
result = dict(engine='Blender Cycles', samples=256, cases=len(measurements),
              maxPixelError=max(m['pixelError'] for m in measurements),
              measurements=measurements)
(OUTPUT / 'native-profile-measurements.json').write_text(json.dumps(result, indent=2))
print(json.dumps({k: v for k, v in result.items() if k != 'measurements'}, indent=2))
assert result['maxPixelError'] < 2, 'Native render differs from circular-aperture prediction'

fixtures = []
for case in cases:
    fixture = {k: case[k] for k in ['name', 'projection', 'width', 'height', 'focalLength', 'focusDistance', 'aperture', 'cameraMatrix', 'projectionMatrix']}
    fixture['edges'] = [{k: m[k] for k in ['depth', 'measuredEdgeWidth', 'sharpEdgeWidth']}
                        for m in measurements if m['name'] == case['name']]
    fixtures.append(fixture)
(ROOT / 'tests/integration/fixtures/add-camera-rigs-dof.json').write_text(json.dumps({
    'source': 'Blender 5.2.2 Cycles, 256 samples; scripts/blender/render-camera-rig-dof.py and analyze-camera-rig-dof.py',
    'cases': fixtures,
}, separators=(',', ':')) + '\n')
