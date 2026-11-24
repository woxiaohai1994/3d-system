import { PerspectiveCamera } from 'three'
import { StringLightNode } from '../../string-lights-plugin/src/schema'
import {
  BuildingNode,
  ColumnNode,
  LevelNode,
  SceneCameraNode,
  SiteNode,
} from '../packages/core/src/schema'

const site = SiteNode.parse({ name: '场景动画验收' }),
  building = BuildingNode.parse({ parentId: site.id }),
  level = LevelNode.parse({ parentId: building.id })
const lens = new PerspectiveCamera()
lens.position.set(0, 4, 10)
lens.lookAt(0, 1.5, 0)
const camera = SceneCameraNode.parse({
  name: '场景动画相机',
  parentId: level.id,
  position: lens.position.toArray(),
  rotation: [lens.rotation.x, lens.rotation.y, lens.rotation.z],
  verticalFov: 45,
})
const item = ColumnNode.parse({
  name: '运动物品',
  parentId: level.id,
  position: [-2, 0, 0],
  height: 1.5,
  width: 1,
  depth: 1,
})
const lights = StringLightNode.parse({
  name: '闪烁灯串',
  parentId: level.id,
  points: [
    [-3, 3, 0],
    [3, 3, 0],
  ],
  effect: 'twinkle',
  bulbSize: 0.16,
  brightness: 3,
  colors: ['#ff3300', '#00ff99', '#3399ff'],
  colorRule: 'sequence',
})
site.children = [building.id]
building.children = [level.id]
level.children = [camera.id, item.id, lights.id as never]
await Bun.write(
  '/tmp/scene-motion-fixture.json',
  JSON.stringify({
    nodes: Object.fromEntries([site, building, level, camera, item, lights].map((n) => [n.id, n])),
    rootNodeIds: [site.id],
  }),
)
