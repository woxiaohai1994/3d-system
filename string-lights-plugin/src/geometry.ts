import {
  Box3,
  BufferGeometry,
  Color,
  Curve,
  CylinderGeometry,
  LatheGeometry,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  Vector2,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { attribute } from 'three/tsl'
import { makeLayout, type Lamp, type LightLayout } from './layout'
import { parseLightSettings, type LightSettings, type Vec3 } from './schema'
import { bulbHead } from './appearance'
import { effectStrength } from './effects'

class SampledCurve extends Curve<Vector3> {
  constructor(readonly points: Vec3[]) {
    super()
  }
  getPoint(t: number, target = new Vector3()) {
    const p = Math.max(0, Math.min(1, t)) * (this.points.length - 1),
      i = Math.floor(p)
    return target
      .fromArray(this.points[i]!)
      .lerp(new Vector3(...this.points[Math.min(i + 1, this.points.length - 1)]!), p - i)
  }
}
type Part = { geometry: BufferGeometry; material: Material; emission: boolean }
type Batch = { mesh: InstancedMesh; emission: InstancedBufferAttribute | null }
const collisionBounds = new WeakMap<Object3D, { key: string; bounds: Box3 }>()
const appearanceKey = (n: LightSettings) =>
  JSON.stringify([n.asset, n.modelScale, n.bulbHead, n.style, n.bulbSize])

function partsBounds(parts: Part[]) {
  const bounds = new Box3()
  for (const part of parts) {
    part.geometry.computeBoundingBox()
    if (part.geometry.boundingBox) bounds.union(part.geometry.boundingBox)
  }
  return bounds
}

export function lampCollisionBounds(n: LightSettings, rendered?: Object3D): Box3 {
  const key = appearanceKey(n)
  let bounds: Box3 | undefined
  rendered?.traverse((object) => {
    const cached = collisionBounds.get(object)
    if (cached?.key === key) bounds = cached.bounds
  })
  if (bounds && !bounds.isEmpty()) return bounds.clone()
  if (n.asset) throw new Error('请等待灯头模型加载后再贴合或缠绕，以检查实际灯头大小。')
  const parts = builtins(n)
  const result = partsBounds(parts)
  for (const part of parts) {
    part.geometry.dispose()
    part.material.dispose()
  }
  return result
}
export type LightGeometry = {
  group: Group
  layout: LightLayout
  animate: (time: number, effectTime?: number, deterministic?: boolean) => void
  colors: () => string[]
  transitionColors: (from: string[], time: number) => void
  isTransitioning: () => boolean
  dispose: () => void
}

function builtins(n: LightSettings): Part[] {
  const head = bulbHead(n)
  const r = n.bulbSize / 2
  let bulb: BufferGeometry
  if (!n.bulbHead) {
    bulb = new SphereGeometry(r, 10, 8)
    if (n.style === 'c9') bulb.scale(0.8, 1.6, 0.8)
    bulb.translate(0, r * (n.style === 'c9' ? 1.8 : 1.2), 0)
  } else if (head === 'silver') {
    bulb = new SphereGeometry(r, 8, 6).scale(1, 1.5, 0.7)
  } else {
    const profile =
      head === 's14'
        ? [
            [0, 0.15],
            [0.4, 0.15],
            [0.5, 0.6],
            [0.8, 1],
            [1, 1.7],
            [0.85, 2.4],
            [0.4, 2.8],
            [0, 2.9],
          ]
        : head === 'c6'
          ? [
              [0, 0.15],
              [0.6, 0.15],
              [1, 0.7],
              [0.92, 1.3],
              [0.65, 1.9],
              [0.3, 2.4],
              [0, 2.7],
            ]
          : head === 'c9'
            ? [
                [0, 0.15],
                [0.6, 0.15],
                [0.95, 0.8],
                [0.85, 1.8],
                [0.55, 2.8],
                [0, 3.6],
              ]
            : [
                [0, 0.1],
                [0.8, 0.1],
                [1, 0.4],
                [1, 1.5],
                [0.7, 2],
                [0, 2.2],
              ]
    bulb = new LatheGeometry(
      profile.map(([x, y]) => new Vector2(x! * r, y! * r)),
      head === 'c6' ? 10 : 16,
    )
    if (head === 'c6') {
      const faceted = bulb.toNonIndexed()
      bulb.dispose()
      bulb = faceted
      bulb.computeVertexNormals()
    }
  }
  const lamp = new MeshStandardNodeMaterial({
    color: '#ffffff',
    roughness: head === 'c6' ? 0.2 : 0.35,
    flatShading: head === 'c6',
  })
  const base = new CylinderGeometry(r * 0.42, r * 0.42, r * 0.55, 8)
  const result: Part[] = [
    { geometry: bulb, material: lamp, emission: true },
    {
      geometry: base,
      material: new MeshStandardNodeMaterial({ color: n.cableColor, roughness: 0.8 }),
      emission: false,
    },
  ]
  if (head === 'silver' && n.bulbHead) {
    result[1]!.geometry.dispose()
    result[1]!.material.dispose()
    result.pop()
  }
  return result
}

function importedParts(n: LightSettings, root: Object3D): Part[] {
  if (!n.asset) return builtins(n)
  const asset = n.asset,
    result: Part[] = []
  root.updateWorldMatrix(true, true)
  const correction = new Matrix4().compose(
    new Vector3(...asset.offset),
    new Quaternion().setFromEuler(new Euler(...asset.rotation)),
    new Vector3(...asset.scale),
  )
  const connection = new Matrix4().makeTranslation(...(asset.connection.map((v) => -v) as Vec3))
  const scale = new Matrix4().makeScale(n.modelScale, n.modelScale, n.modelScale)
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh || !mesh.geometry || !mesh.visible) return
    const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (let slot = 0; slot < sources.length; slot++) {
      const source = sources[slot]!,
        geometry = mesh.geometry.clone()
      if (sources.length > 1) {
        const indices: number[] = []
        for (const group of geometry.groups)
          if (group.materialIndex === slot) {
            for (let i = group.start; i < group.start + group.count; i++)
              indices.push(geometry.index ? geometry.index.getX(i) : i)
          }
        if (!indices.length) {
          geometry.dispose()
          continue
        }
        geometry.setIndex(indices)
        geometry.clearGroups()
      }
      geometry.applyMatrix4(
        scale.clone().multiply(connection).multiply(correction).multiply(mesh.matrixWorld),
      )
      const material = new MeshStandardNodeMaterial()
      const standard = source as MeshStandardMaterial
      material.color.copy(standard.color ?? new Color('white'))
      material.map = standard.map ?? null
      material.normalMap = standard.normalMap ?? null
      material.roughness = standard.roughness ?? 0.7
      material.metalness = standard.metalness ?? 0
      material.transparent = source.transparent
      material.opacity = source.opacity
      material.side = source.side
      material.alphaTest = source.alphaTest
      const emission =
        asset.emissionMaterials.includes(source.name) || asset.emissionMaterials.includes(mesh.name)
      if (!emission && standard.emissive) {
        material.emissive.copy(standard.emissive)
        material.emissiveIntensity = standard.emissiveIntensity ?? 1
        material.emissiveMap = standard.emissiveMap ?? null
      }
      result.push({ geometry, material, emission })
    }
  })
  return result
}

export function lampMatrix(
  n: LightSettings,
  lamp: Lamp,
  time: number,
  target = new Matrix4(),
): Matrix4 {
  const orientation = new Quaternion(),
    up = new Vector3(0, 1, 0)
  if (n.orientation === 'down') orientation.setFromUnitVectors(up, new Vector3(0, -1, 0))
  else if (n.orientation === 'tangent')
    orientation.setFromUnitVectors(up, new Vector3(...lamp.tangent))
  else if (n.orientation === 'branch') {
    const branch = new Vector3(...lamp.branch)
    if (branch.lengthSq() > 1e-8) orientation.setFromUnitVectors(up, branch)
  } else if (n.orientation === 'outward') {
    const direction = new Vector3(lamp.position[0], 0, lamp.position[2])
    if (direction.lengthSq() > 1e-8) orientation.setFromUnitVectors(up, direction.normalize())
  }
  const sway = n.sway * lamp.weight * Math.sin(time * n.swaySpeed + lamp.phase)
  if (n.orientation !== 'branch')
    orientation.premultiply(
      new Quaternion().setFromAxisAngle(new Vector3(...lamp.tangent), lamp.wireRotation),
    )
  orientation.multiply(new Quaternion().setFromAxisAngle(up, lamp.axialRotation))
  orientation.multiply(
    new Quaternion().setFromEuler(
      new Euler(lamp.tilt[0] + sway, lamp.tilt[1], lamp.tilt[2] + sway * 0.3),
    ),
  )
  return target.compose(
    new Vector3(...lamp.position),
    orientation,
    new Vector3().setScalar(lamp.scale),
  )
}

export function buildLightGeometry(n: LightSettings, model?: Object3D): LightGeometry {
  n = parseLightSettings(n)
  const layout = makeLayout(n),
    group = new Group(),
    batches: Batch[] = []
  const geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>()
  const own = (geometry: BufferGeometry, material: Material) => {
    geometries.add(geometry)
    materials.add(material)
  }
  if (n.mode !== 'scatter' && n.cableVisible && layout.cable.length > 1) {
    const g = new TubeGeometry(
      new SampledCurve(layout.cable),
      Math.min(4000, layout.cable.length * 2),
      n.cableRadius,
      5,
      false,
    )
    const m = new MeshStandardNodeMaterial({ color: n.cableColor, roughness: 0.8 })
    own(g, m)
    group.add(new Mesh(g, m))
    const shortParts = layout.bulbs.filter(
      (b) => new Vector3(...b.position).distanceTo(new Vector3(...b.mount)) > 0.001,
    )
    if (shortParts.length) {
      const geometry = new CylinderGeometry(n.cableRadius * 0.65, n.cableRadius * 0.65, 1, 5)
      const mesh = new InstancedMesh(geometry, m, shortParts.length),
        matrix = new Matrix4()
      own(geometry, m)
      shortParts.forEach((bulb, i) => {
        const a = new Vector3(...bulb.mount),
          b = new Vector3(...bulb.position),
          direction = b.clone().sub(a)
        matrix.compose(
          a.add(b).multiplyScalar(0.5),
          new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize()),
          new Vector3(1, direction.length(), 1),
        )
        mesh.setMatrixAt(i, matrix)
      })
      mesh.computeBoundingSphere()
      group.add(mesh)
    }
  }
  const parts = model && n.asset ? importedParts(n, model) : builtins(n)
  if (!n.asset || model)
    collisionBounds.set(group, { key: appearanceKey(n), bounds: partsBounds(parts) })
  for (const part of parts) {
    const mesh = new InstancedMesh(part.geometry, part.material, layout.bulbs.length)
    let emission: InstancedBufferAttribute | null = null
    if (part.emission) {
      emission = new InstancedBufferAttribute(new Float32Array(layout.bulbs.length * 3), 3)
      part.geometry.setAttribute('lightEmission', emission)
      ;(part.material as MeshStandardNodeMaterial).emissiveNode = attribute('lightEmission', 'vec3')
    }
    layout.bulbs.forEach((bulb, i) => {
      mesh.setMatrixAt(i, lampMatrix(n, bulb, 0))
      if (part.emission) mesh.setColorAt(i, new Color(bulb.color))
    })
    mesh.computeBoundingSphere()
    if (mesh.boundingSphere) mesh.boundingSphere.radius += n.bulbSize * 2 + n.sway
    own(part.geometry, part.material)
    group.add(mesh)
    batches.push({ mesh, emission })
  }
  const matrix = new Matrix4(),
    color = new Color()
  const targets = layout.bulbs.map((b) => new Color(b.color))
  const currentColors = targets.map((c) => c.clone())
  let colorStart: Color[] | null = null
  let colorStartTime = 0
  const animate = (time: number, effectTime?: number, deterministic = false) => {
    const changingColor = deterministic || colorStart !== null
    if (deterministic) currentColors.forEach((color, i) => color.copy(targets[i]!))
    if (colorStart && !deterministic) {
      const progress = Math.max(0, Math.min(1, (time - colorStartTime) / 0.35))
      const eased = progress * progress * (3 - 2 * progress)
      currentColors.forEach((c, i) => c.copy(colorStart![i]!).lerp(targets[i]!, eased))
      if (progress >= 1) colorStart = null
    }
    for (const batch of batches) {
      layout.bulbs.forEach((bulb, i) => {
        if (n.sway) batch.mesh.setMatrixAt(i, lampMatrix(n, bulb, time, matrix))
        if (batch.emission) {
          if (changingColor) batch.mesh.setColorAt(i, currentColors[i]!)
          color
            .copy(currentColors[i]!)
            .multiplyScalar(
              n.brightness *
                effectStrength(
                  effectTime === undefined ? n : { effect: n.effect, effectSpeed: 1 },
                  i,
                  bulb.phase,
                  effectTime ?? time,
                ),
            )
          batch.emission.setXYZ(i, color.r, color.g, color.b)
        }
      })
      if (n.sway) batch.mesh.instanceMatrix.needsUpdate = true
      if (batch.emission) batch.emission.needsUpdate = true
      if (changingColor && batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true
    }
  }
  animate(0)
  return {
    group,
    layout,
    animate,
    colors: () => currentColors.map((c) => `#${c.getHexString()}`),
    transitionColors: (from, time) => {
      if (from.length !== targets.length || from.every((c, i) => c === layout.bulbs[i]!.color))
        return
      colorStart = from.map((c) => new Color(c))
      colorStartTime = time
    },
    isTransitioning: () => colorStart !== null,
    dispose: () => {
      collisionBounds.delete(group)
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
      group.traverse((o) => {
        if (o instanceof InstancedMesh) o.dispose()
      })
    },
  }
}
