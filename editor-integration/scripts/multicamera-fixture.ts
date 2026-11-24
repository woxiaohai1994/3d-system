import { readFile } from 'node:fs/promises'
import { PerspectiveCamera } from 'three'
import {
  CameraMotion,
  CameraMotionPoint,
  CameraMotionSegment,
  ObjectMotionTrack,
  SceneCameraNode,
} from '../packages/core/src/schema'

await import('./scene-motion-fixture')
const graph = JSON.parse(await readFile('/tmp/scene-motion-fixture.json', 'utf8'))
const values = Object.values(graph.nodes) as any[]
const camera = values.find((n) => n.type === 'scene-camera'),
  item = values.find((n) => n.type === 'column'),
  level = values.find((n) => n.type === 'level')
camera.name = '全景相机 A'
const points = [0, 4].map((time, i) =>
  CameraMotionPoint.parse({
    time,
    position: [i, 4, 10],
    rotation: camera.rotation,
    verticalFov: 45,
    orthographicHeight: 10,
    orbitDistance: 10,
  }),
)
camera.motion = CameraMotion.parse({
  duration: 4,
  points,
  segments: [
    CameraMotionSegment.parse({
      fromId: points[0]!.id,
      toId: points[1]!.id,
      rhythm: 'linear',
      path: 'line',
    }),
  ],
  objects: [
    ObjectMotionTrack.parse({
      nodeId: item.id,
      parentId: level.id,
      points: [
        { time: 0, position: [-2, 0, 0], rotation: [0, 0, 0], easing: [0, 0, 1, 1] },
        { time: 4, position: [2, 0, 0], rotation: [0, 0, 0] },
      ],
    }),
  ],
})
const lens = new PerspectiveCamera()
lens.position.set(8, 5, 6)
lens.lookAt(0, 1.5, 0)
const second = SceneCameraNode.parse({
  name: '侧面相机 B',
  parentId: level.id,
  position: lens.position.toArray(),
  rotation: [lens.rotation.x, lens.rotation.y, lens.rotation.z],
  projection: 'orthographic',
  orthographicHeight: 7,
  aspectRatio: '9:16',
})
graph.nodes[second.id] = second
level.children.push(second.id)
await Bun.write('/tmp/multicamera-fixture.json', JSON.stringify(graph))
