#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Compile Blender v4.3's stateful camera-switch find/update functions unchanged."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'vendor/blender-scene-camera/scene.cc'
TARGET = SOURCE.parent / 'retention-fixtures.json'


def function(text, name):
    masked = re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', lambda match: ' ' * len(match[0]), text)
    match = re.search(r'^[\w *]+\b' + name + r'\([^;{}]*\)\s*\{', masked, re.M)
    assert match, name
    end, depth = match.end(), 1
    while depth:
        depth += (masked[end] == '{') - (masked[end] == '}')
        end += 1
    return text[match.start():end].strip()


def cases():
    marker_b = dict(id='B48', frame=48, cameraId='B')
    marker_a = dict(id='A24', frame=24, cameraId='A')
    update = lambda frame: dict(operation='update', frame=frame)
    result = []
    for operation in ['delete', 'unbind']:
        for initial in ['A', None]:
            result.append(dict(id=f'{operation}-last-valid-from-{initial or "none"}',
                               initialCamera=initial, markers=[marker_b],
                               events=[update(48), dict(operation=operation, markerId='B48'),
                                       update(48), update(72)]))
        result.append(dict(id=f'{operation}-valid-retaining-unbound-marker', initialCamera='A',
                           markers=[marker_b, dict(id='unbound', frame=60, cameraId=None)],
                           events=[update(48), dict(operation=operation, markerId='B48'), update(72)]))
        result.append(dict(id=f'{operation}-selected-with-earlier-valid', initialCamera='A',
                           markers=[marker_a, marker_b],
                           events=[update(48), dict(operation=operation, markerId='B48'), update(48)]))
        result.append(dict(id=f'{operation}-after-seeking-back', initialCamera='A',
                           markers=[marker_a, marker_b],
                           events=[update(48), update(24), dict(operation=operation, markerId='B48'), update(72)]))
        result.append(dict(id=f'{operation}-after-manual-active', initialCamera='A', markers=[marker_b],
                           events=[update(48), dict(operation='active', cameraId='C'),
                                   dict(operation=operation, markerId='B48'), update(72)]))
    result.append(dict(id='no-markers-retain-existing-camera', initialCamera='A', markers=[],
                       events=[update(0), update(48), update(72)]))
    return result


PREFIX = r'''
#include <algorithm>
#include <iostream>
#include <list>
#include <string>
#include <vector>
#define DURIAN_CAMERA_SWITCH
#define MAXFRAME 1048574
enum { R_NO_CAMERA_SWITCH = 1 << 12, OB_HIDE_RENDER = 1 << 2, ID_RECALC_SYNC_TO_EVAL = 1 };
struct Object { const char *name; int visibility_flag = 0; };
struct TimeMarker { std::string id; int frame; Object *camera; };
struct Scene { struct { int mode = 0; } r; double frame; std::vector<TimeMarker *> markers;
               Object *camera; int id = 0; };
#define LISTBASE_FOREACH(type, variable, list) for (type variable : *(list))
static double BKE_scene_ctime_get(const Scene *scene) { return scene->frame; }
static void DEG_id_tag_update(int *, int) {}
'''

MAIN = r'''
static Object cameras[] = {{"A"}, {"B"}, {"C"}};
static Object *camera(const std::string &id) { return id == "-" ? nullptr : &cameras[id[0] - 'A']; }
static void camera_json(Object *object) {
  if (object) std::cout << '"' << object->name << '"'; else std::cout << "null";
}
int main() {
  std::cout << std::boolalpha;
  std::string initial;
  int marker_count, event_count;
  while (std::cin >> initial >> marker_count >> event_count) {
    Scene scene{}; scene.camera = camera(initial);
    std::list<TimeMarker> storage;
    for (int index = 0; index < marker_count; index++) {
      std::string id, object; int frame;
      std::cin >> id >> frame >> object;
      storage.push_back({id, frame, camera(object)});
      scene.markers.push_back(&storage.back());
    }
    std::cout << '[';
    for (int index = 0; index < event_count; index++) {
      std::string operation, argument;
      std::cin >> operation >> argument;
      bool updated = false;
      if (operation == "update") {
        scene.frame = std::stoi(argument);
        updated = BKE_scene_camera_switch_update(&scene);
      }
      else if (operation == "active") { scene.camera = camera(argument); }
      else {
        auto marker = std::find_if(scene.markers.begin(), scene.markers.end(),
                                  [&](TimeMarker *item) { return item->id == argument; });
        if (marker == scene.markers.end()) return 2;
        if (operation == "delete") scene.markers.erase(marker);
        else if (operation == "unbind") (*marker)->camera = nullptr;
        else return 3;
      }
      if (index) std::cout << ',';
      std::cout << "{\"sceneCamera\":"; camera_json(scene.camera);
      std::cout << ",\"selectedMarkerCamera\":"; camera_json(BKE_scene_camera_switch_find(&scene));
      std::cout << ",\"updated\":" << updated << '}';
    }
    std::cout << "]\n";
  }
}
'''


def generate():
    manifest = json.loads((SOURCE.parent / 'UPSTREAM.json').read_text())
    raw = SOURCE.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == manifest['sha256']
    source = raw.decode()
    native = PREFIX + '\n' + '\n\n'.join(function(source, name) for name in
                        ['BKE_scene_camera_switch_find', 'BKE_scene_camera_switch_update']) + '\n' + MAIN
    result = cases()
    lines = []
    for case in result:
        values = [case['initialCamera'] or '-', len(case['markers']), len(case['events'])]
        for marker in case['markers']:
            values += [marker['id'], marker['frame'], marker['cameraId'] or '-']
        for event in case['events']:
            argument = event.get('frame', event.get('markerId', event.get('cameraId')))
            values += [event['operation'], argument]
        lines.append(' '.join(map(str, values)))
    with tempfile.TemporaryDirectory(prefix='blender-scene-camera-retention-') as folder:
        build = Path(folder)
        cpp, executable = build / 'retention.cc', build / 'retention'
        cpp.write_text(native)
        subprocess.run(['clang++', '-std=c++17', '-O2', '-ffp-contract=off', str(cpp),
                        '-o', str(executable)], check=True)
        outputs = subprocess.check_output([str(executable)], input='\n'.join(lines), text=True).splitlines()
        assert len(outputs) == len(result)
        for case, output in zip(result, outputs):
            case['states'] = json.loads(output)
    return dict(metadata={**manifest,
                'generatorHash': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'translationUnitHash': hashlib.sha256(native.encode()).hexdigest(),
                'functions': ['BKE_scene_camera_switch_find', 'BKE_scene_camera_switch_update'],
                'boundaryModel': 'Original function bodies compile unchanged. Scene/camera/marker storage and dependency-update notification are host boundaries; delete/unbind/manual-active actions mutate those boundary records. This is a native C++ source oracle, not the installed Blender 5.2.2 application.'},
                cases=result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = generate()
    text = json.dumps(result, indent=2) + '\n'
    if args.check:
        assert TARGET.read_text() == text, 'Scene camera retention native fixtures changed'
    else:
        TARGET.write_text(text)
    print('Native Blender v4.3 camera retention: %d cases / %d events%s' %
          (len(result['cases']), sum(len(case['events']) for case in result['cases']),
           ' (checked)' if args.check else ''))


if __name__ == '__main__':
    main()
