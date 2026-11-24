import { PerspectiveCamera } from 'three'
import {
  BuildingNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SceneCameraNode,
  SiteNode,
  SlabNode,
  WallNode,
} from '../packages/core/src/schema'

const site = SiteNode.parse({ name: '运镜房屋验收' })
const building = BuildingNode.parse({ parentId: site.id })
const level = LevelNode.parse({ parentId: building.id, level: 0 })
const lens = new PerspectiveCamera()
lens.position.set(0, 1.4, 10)
lens.lookAt(0, 2.8, 0)
const camera = SceneCameraNode.parse({
  parentId: level.id,
  name: '房屋运镜验收相机',
  position: lens.position.toArray(),
  rotation: [lens.rotation.x, lens.rotation.y, lens.rotation.z],
  verticalFov: 50,
  aspectRatio: process.env.MOTION_ASPECT ?? '16:9',
})
const corners: [number, number][] = [
  [-3, -2],
  [3, -2],
  [3, 2],
  [-3, 2],
]
const walls = corners.map((start, i) =>
  WallNode.parse({
    parentId: level.id,
    name: `房屋墙 ${i + 1}`,
    start,
    end: corners[(i + 1) % 4],
    height: 3,
    thickness: 0.2,
  }),
)
const roof = RoofNode.parse({ parentId: level.id, name: '屋檐锚点', position: [0, 3.05, 0] })
const segment = RoofSegmentNode.parse({
  parentId: roof.id,
  width: 6.2,
  depth: 4.2,
  wallHeight: 0,
  pitch: 25,
  overhang: 0.4,
})
roof.children = [segment.id]
const floor = SlabNode.parse({ parentId: level.id, name: '房屋地坪', polygon: corners })
site.children = [building.id]
building.children = [level.id]
level.children = [camera.id, roof.id, floor.id, ...walls.map((n) => n.id)]
const nodes = Object.fromEntries(
  [site, building, level, camera, roof, segment, floor, ...walls].map((n) => [n.id, n]),
)
await Bun.write(
  process.argv[2] ?? '/tmp/camera-motion-house.json',
  JSON.stringify({ nodes, rootNodeIds: [site.id] }),
)
