# SPDX-License-Identifier: GPL-3.0-or-later
"""Development-only operator oracle; records upstream behavior and explicit defect repairs."""
import copy
import json
from pathlib import Path
import runpy

env = runpy.run_path(str(Path(__file__).with_name('export-camera-rigs.py')))
evaluate, rigs, ROOT = env['evaluate'], env['rigs'], env['ROOT']
cases = []
for kind in ['dolly', 'crane', '2d']:
    for transformed in [False, True]:
        bones = copy.deepcopy(rigs[kind][2])
        bones['Camera']['location'] = [1, -2, .5]
        bones['Aim']['location'] = [2, 1, 3]
        if kind != '2d':
            bones['Camera']['properties'].update(lens=70, lens_offset=5, lens_breathing_scale=.3, focus_distance=8)
        if transformed:
            bones['Root'].update(location=[2, 3, -1], rotation=[.3, .5, .8], scale=[2, .7, 1.4])
            bones['Camera']['rotation'] = [.2, -.3, .6]
            if kind == 'crane':
                bones['Crane_Height']['scale'] = [1, 2, 1]
                bones['Crane_Arm'].update(scale=[1, 3, 1], rotation=[.4, 0, .7])
        for operation in ['set_dolly_zoom', 'remove_dolly_zoom', 'swap_lens', 'set_dof_bone']:
            if kind == '2d' and operation != 'set_dof_bone':
                continue
            request = dict(type=kind, bones=copy.deepcopy(bones), aspect=16/9, projection='perspective', tracking=.75, focusOnAim=False)
            if operation == 'remove_dolly_zoom':
                request['dollyDistance'] = 7.5
            before = evaluate(request)
            upstream = evaluate(dict(request, operation=operation, lens=100))
            defect = None
            expected = upstream
            if operation == 'set_dof_bone':
                # focus-object RNA callbacks in 1.9.0 search the rig's lens_without_breathing
                # driver for a variable owned by the camera lens driver. Record the result
                # separately; evaluate the intended source focus target for the native port.
                defect = 'focus callback searches the wrong driver for focus_distance'
                expected = evaluate(dict(request, focusBone='DOF' if kind=='2d' else 'Aim'))
            cases.append(dict(request=request, operation=operation, lens=100, before=before, upstream=upstream, expected=expected, upstreamDefect=defect))
(ROOT/'tests/integration/fixtures/add-camera-rigs-operators.json').write_text(json.dumps(cases, separators=(',', ':')))
print('Exported', len(cases), 'original operator cases with recorded upstream defects')
