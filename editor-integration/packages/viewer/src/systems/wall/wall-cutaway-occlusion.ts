import { detectSpacesForLevel, pointInPolygon, type WallNode } from '@pascal-app/core'
import { Box3, type Camera, Matrix4, type Mesh, Ray, Vector3 } from 'three'
import { getSceneHiddenReasons } from '../../lib/scene-visibility'

export type CutawayWall = { node: WallNode; mesh: Mesh; matrix: Matrix4; normal: Vector3 }
type Region = { levelId: string; polygon: [number, number][] }
type Solid = { id: string; group: string; wall: CutawayWall; inverse: Matrix4; box: Box3 }

// Separate entry/exit thresholds prevent a side wall flickering during an orbit.
export const CUTAWAY_HIDE_COVERAGE = 0.12
export const CUTAWAY_KEEP_COVERAGE = 0.08
const GRID = 16

function authoredFrame(wall: CutawayWall): Matrix4 {
  const { start, end } = wall.node
  return new Matrix4()
    .makeRotationY(-Math.atan2(end[1] - start[1], end[0] - start[0]))
    .setPosition(start[0], 0, start[1])
}

export class WallCutawayOcclusion {
  private signature = ''
  private regions: Region[] = []
  private hidden = new Set<string>()
  private ray = new Ray()
  private localRay = new Ray()
  private hit = new Vector3()
  private a = new Vector3()
  private b = new Vector3()
  private c = new Vector3()

  clear(): void {
    this.signature = ''
    this.regions = []
    this.hidden.clear()
  }

  resolve(camera: Camera, walls: CutawayWall[], focus?: Vector3): Set<string> {
    const signature = JSON.stringify(
      walls.map(({ node }) => [
        node.id,
        node.parentId,
        node.start,
        node.end,
        node.curveOffset,
        node.visible,
      ]),
    )
    if (signature !== this.signature) {
      this.signature = signature
      const levels = new Map<string, WallNode[]>()
      for (const { node } of walls) {
        if (!node.visible) continue
        const key = node.parentId ?? ''
        const list = levels.get(key) ?? []
        list.push(node)
        levels.set(key, list)
      }
      this.regions = Array.from(levels).flatMap(([levelId, nodes]) =>
        detectSpacesForLevel(levelId, nodes).spaces.map(({ polygon }) => ({ levelId, polygon })),
      )
    }
    const solids = this.solids(walls)
    const visibleLevels = new Set(solids.map(({ wall }) => wall.node.parentId ?? ''))
    const frames = new Map<string, Matrix4>()
    for (const wall of walls) {
      const key = wall.node.parentId ?? ''
      if (!frames.has(key))
        frames.set(key, wall.matrix.clone().multiply(authoredFrame(wall).invert()))
    }
    const position = camera.getWorldPosition(new Vector3())
    const direction = camera.getWorldDirection(new Vector3())
    let region: Region | undefined
    let nearest = Infinity
    for (const candidate of this.regions) {
      if (!visibleLevels.has(candidate.levelId)) continue
      const frame = frames.get(candidate.levelId)!
      const local = (focus ?? position).clone().applyMatrix4(frame.clone().invert())
      const contained = focus && pointInPolygon(local.x, local.z, candidate.polygon)
      let distance = Infinity
      for (const [x, z] of candidate.polygon) {
        const point = new Vector3(x, 1, z).applyMatrix4(frame)
        const delta = point.sub(position)
        const forward = delta.dot(direction)
        if (forward <= 0) continue
        const score = focus
          ? point.add(position).distanceToSquared(focus)
          : delta.addScaledVector(direction, -forward).lengthSq()
        distance = Math.min(distance, score)
      }
      if (contained) distance = Math.abs(local.y - 1) * 0.01
      if (distance < nearest) {
        nearest = distance
        region = candidate
      }
    }
    if (!region) {
      this.hidden = new Set()
      return this.hidden
    }
    const frame = frames.get(region.levelId)!
    const inverseFrame = frame.clone().invert()
    const roomBounds = new Box3()
    for (const [x, z] of region.polygon) roomBounds.expandByPoint(new Vector3(x, 0, z))
    const size = roomBounds.getSize(new Vector3())
    const localFocus = focus?.clone().applyMatrix4(inverseFrame)
    const roomSolids = solids.filter(({ wall }) => (wall.node.parentId ?? '') === region.levelId)
    const heights = roomSolids
      .map(({ box }) => box.max.y)
      .filter((y) => y > 0.2)
      .sort((a, b) => a - b)
    const height = heights[Math.floor(heights.length / 2)] ?? 2.8
    const centerY = Math.max(height * 0.2, Math.min(height * 0.7, localFocus?.y ?? height * 0.45))
    // Every sample ray stays inside this volume; distant floors/rooms need no ray tests.
    const volume = new Box3().expandByPoint(position)
    for (const x of [roomBounds.min.x, roomBounds.max.x]) {
      for (const z of [roomBounds.min.z, roomBounds.max.z]) {
        for (const y of [centerY - height * 0.15, centerY + height * 0.15]) {
          const point = new Vector3(x, y, z).applyMatrix4(frame)
          volume.expandByPoint(point)
          if ('isOrthographicCamera' in camera) {
            const distance = point.clone().sub(position).dot(direction)
            volume.expandByPoint(point.addScaledVector(direction, -distance))
          }
        }
      }
    }
    const candidates = solids.filter(({ box, wall }) =>
      box.clone().applyMatrix4(wall.matrix).intersectsBox(volume),
    )
    const samples: { weight: number; hits: string[] }[] = []
    for (let x = 0; x < GRID; x++) {
      for (let z = 0; z < GRID; z++) {
        const px = roomBounds.min.x + ((x + 0.5) / GRID) * size.x
        const pz = roomBounds.min.z + ((z + 0.5) / GRID) * size.z
        if (!pointInPolygon(px, pz, region.polygon)) continue
        for (const y of [centerY - height * 0.15, centerY, centerY + height * 0.15]) {
          const point = new Vector3(px, y, pz).applyMatrix4(frame)
          const projected = point.clone().project(camera)
          if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1)
            continue
          const distance = point.distanceTo(position)
          this.ray.set(position, point.clone().sub(position).normalize())
          let limit = distance
          // Orthographic rays are parallel; their origin is the sample's camera-plane projection.
          if ('isOrthographicCamera' in camera) {
            limit = point.clone().sub(position).dot(direction)
            this.ray.direction.copy(direction)
            this.ray.origin.copy(point).addScaledVector(direction, -limit)
          }
          const hits: { group: string; distance: number }[] = []
          for (const solid of candidates) {
            const hitDistance = this.intersection(solid)
            if (hitDistance !== null && hitDistance > 0.02 && hitDistance < limit - 0.05)
              hits.push({ group: solid.group, distance: hitDistance })
          }
          hits.sort((a, b) => a.distance - b.distance)
          samples.push({
            weight: 'isOrthographicCamera' in camera ? 1 : 1 / Math.max(1, distance * distance),
            hits: [...new Set(hits.map(({ group }) => group))],
          })
        }
      }
    }
    const total = samples.reduce((sum, sample) => sum + sample.weight, 0)
    const groups = new Set<string>()
    while (total > 0) {
      const scores = new Map<string, number>()
      for (const sample of samples) {
        const blocker = sample.hits.find((id) => !groups.has(id))
        if (blocker) scores.set(blocker, (scores.get(blocker) ?? 0) + sample.weight)
      }
      let best: string | undefined
      let coverage = 0
      for (const [id, score] of scores) {
        const threshold = this.hidden.has(id) ? CUTAWAY_KEEP_COVERAGE : CUTAWAY_HIDE_COVERAGE
        if (score / total >= threshold && score > coverage) {
          best = id
          coverage = score
        }
      }
      if (!best) break
      groups.add(best)
    }
    this.hidden = groups
    return new Set(solids.filter(({ group }) => groups.has(group)).map(({ id }) => id))
  }

  private solids(walls: CutawayWall[]): Solid[] {
    const solids: Solid[] = []
    for (const wall of walls) {
      let visible = wall.node.visible
      for (let parent = wall.mesh.parent; parent; parent = parent.parent) visible &&= parent.visible
      if (
        !visible ||
        getSceneHiddenReasons(wall.mesh).some(
          (reason) => reason === 'isolated' || reason === 'shadow-only',
        )
      )
        continue
      const geometry =
        (wall.mesh.getObjectByName('collision-mesh') as Mesh | undefined)?.geometry ??
        wall.mesh.geometry
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) continue
      solids.push({
        id: wall.node.id,
        group: wall.node.id,
        wall,
        inverse: wall.matrix.clone().invert(),
        box: geometry.boundingBox,
      })
    }
    // Joined collinear wall nodes represent one facade and must disappear together.
    const endpoints = new Map<string, Solid[]>()
    const parents = new Map(solids.map((solid) => [solid.id, solid.id]))
    const root = (id: string): string => {
      const parent = parents.get(id)!
      if (parent === id) return id
      const result = root(parent)
      parents.set(id, result)
      return result
    }
    for (const solid of solids) {
      if (solid.wall.node.curveOffset) continue
      const { node, matrix } = solid.wall
      const length = Math.hypot(node.end[0] - node.start[0], node.end[1] - node.start[1])
      for (const x of [0, length]) {
        const point = new Vector3(x, 0, 0).applyMatrix4(matrix)
        const key = `${node.parentId}:${point.x.toFixed(3)}:${point.y.toFixed(3)}:${point.z.toFixed(3)}`
        const joined = endpoints.get(key) ?? []
        for (const other of joined) {
          if (Math.abs(solid.wall.normal.dot(other.wall.normal)) > 0.999)
            parents.set(root(solid.id), root(other.id))
        }
        joined.push(solid)
        endpoints.set(key, joined)
      }
    }
    for (const solid of solids) solid.group = root(solid.id)
    return solids
  }

  private intersection(solid: Solid): number | null {
    this.localRay.copy(this.ray).applyMatrix4(solid.inverse)
    if (!this.localRay.intersectBox(solid.box, this.hit)) return null
    if (solid.wall.node.curveOffset) {
      const mesh = solid.wall.mesh.getObjectByName('collision-mesh') as Mesh | undefined
      const geometry = mesh?.geometry ?? solid.wall.mesh.geometry
      const positions = geometry.getAttribute('position')
      const index = geometry.index
      let distance = Infinity
      for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
        this.a.fromBufferAttribute(positions, index ? index.getX(i) : i)
        this.b.fromBufferAttribute(positions, index ? index.getX(i + 1) : i + 1)
        this.c.fromBufferAttribute(positions, index ? index.getX(i + 2) : i + 2)
        if (this.localRay.intersectTriangle(this.a, this.b, this.c, false, this.hit))
          distance = Math.min(
            distance,
            this.hit.applyMatrix4(solid.wall.matrix).distanceTo(this.ray.origin),
          )
      }
      return Number.isFinite(distance) ? distance : null
    }
    return this.hit.applyMatrix4(solid.wall.matrix).distanceTo(this.ray.origin)
  }
}
