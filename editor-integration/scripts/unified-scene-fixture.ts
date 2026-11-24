import { readFile } from 'node:fs/promises'
import { PerspectiveCamera } from 'three'
import {
  CameraMotionPoint,
  MotionSegment,
  MotionTrack,
  SceneAnimation,
  SceneCameraNode,
} from '../packages/core/src/schema'

await import('./scene-motion-fixture')
const graph = JSON.parse(await readFile('/tmp/scene-motion-fixture.json', 'utf8'))
const values = Object.values(graph.nodes) as any[]
const camera = values.find((n) => n.type === 'scene-camera'),
  item = values.find((n) => n.type === 'column'),
  level = values.find((n) => n.type === 'level'),
  site = values.find((n) => n.type === 'site')
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
site.animation = SceneAnimation.parse({
  duration: 5,
  defaultCameraId: camera.id,
  tracks: [
    {
      kind: 'camera',
      nodeId: camera.id,
      parentId: camera.parentId,
      points,
      segments: [
        MotionSegment.parse({
          fromId: points[0]!.id,
          toId: points[1]!.id,
          rhythm: 'linear',
          path: 'line',
        }),
      ],
    },
    {
      kind: 'object',
      ...MotionTrack.parse({
        nodeId: item.id,
        parentId: level.id,
        points: [
          { time: 0, position: [-2, 0, 0], rotation: [0, 0, 0], easing: [0, 0, 1, 1] },
          { time: 4, position: [2, 0, 0], rotation: [0, 0, 0] },
        ],
      }),
    },
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
await Bun.write('/tmp/unified-scene-fixture.json', JSON.stringify(graph))
