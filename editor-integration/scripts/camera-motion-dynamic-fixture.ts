import { PerspectiveCamera } from 'three'
import { exportEnvironmentConfiguration } from '../node_modules/@pascal-app/plugin-environment/src/presentation-configuration'
import { PoolNode } from '../node_modules/@pascal-app/plugin-pool/src/core/schema'
import {
  BuildingNode,
  CameraMotion,
  CameraMotionPoint,
  CameraMotionSegment,
  ItemNode,
  LevelNode,
  SceneCameraNode,
  SiteNode,
} from '../packages/core/src/schema'

const site = SiteNode.parse({ name: '动态运镜验收' })
const building = BuildingNode.parse({ parentId: site.id })
const level = LevelNode.parse({ parentId: building.id, level: 0 })
const pool = PoolNode.parse({
  parentId: level.id,
  name: '可重播水波',
  waterMode: 'storm',
  rain: 0.8,
  breeze: 0.6,
})
const lens = new PerspectiveCamera()
lens.position.set(6, 6, 8)
lens.lookAt(0, 0, 0)
const pose = {
  position: lens.position.toArray(),
  rotation: [lens.rotation.x, lens.rotation.y, lens.rotation.z],
  verticalFov: 50,
  orthographicHeight: 10,
  orbitDistance: 10,
}
const points = [0, 1.5, 3].map((time, i) =>
  CameraMotionPoint.parse({ ...pose, time, name: String.fromCharCode(65 + i) }),
)
const segments = points
  .slice(1)
  .map((point, i) => CameraMotionSegment.parse({ fromId: points[i]!.id, toId: point.id }))
const camera = SceneCameraNode.parse({
  parentId: level.id,
  name: '动态场景验收相机',
  ...pose,
  motion: CameraMotion.parse({ points, segments, fps: 24, resolution: 720 }),
})
site.children = [building.id]
building.children = [level.id]
level.children = [camera.id, pool.id]
await Bun.write(
  process.argv[2] ?? '/tmp/camera-motion-dynamic.json',
  JSON.stringify({
    nodes: Object.fromEntries([site, building, level, pool, camera].map((n) => [n.id, n])),
    rootNodeIds: [site.id],
  }),
)

const environment = exportEnvironmentConfiguration()
await Bun.write(
  '/tmp/camera-motion-weather.json',
  JSON.stringify({
    version: 1,
    projectId: 'local-editor',
    contributions: {
      'pascal:environment:presentation': {
        ...environment,
        visibility: { sky: true, surroundings: false },
        weather: { rain: 0.7, snow: 0, wind: 0.3, storm: true },
      },
    },
  }),
)

const missing = ItemNode.parse({
  parentId: level.id,
  name: '缺失模型验收',
  position: [0, 0, 4],
  asset: {
    id: 'missing-motion-test',
    category: 'test',
    name: '缺失模型验收',
    thumbnail: '',
    src: 'http://localhost:3002/__motion_missing.glb',
  },
})
const missingLevel = { ...level, children: [...level.children, missing.id] }
await Bun.write(
  '/tmp/camera-motion-missing.json',
  JSON.stringify({
    nodes: Object.fromEntries(
      [site, building, missingLevel, pool, camera, missing].map((n) => [n.id, n]),
    ),
    rootNodeIds: [site.id],
  }),
)
