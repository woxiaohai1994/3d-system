// SPDX-License-Identifier: GPL-3.0-or-later
import type { BlenderRigRequest, BlenderRigState } from '@pascal-app/core'
import { clampCameraFocalLength } from '@pascal-app/core'
import { Euler, Matrix4, OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { nativeRigOffsets } from './add-camera-rigs-offsets-source'
import { cameraRigsSource } from './add-camera-rigs-source'
import type { BlenderRigResult, BlenderRigWidget } from './blender-camera-rig'
import { evaluateRigExpression } from './rig-expression'
import {
  blendRigMatrices,
  invertRigMatrix,
  rigCopyRotation,
  rigMatrixComponents,
  rigOrthonormalBasis,
  transformRigPoint,
} from './rig-matrix'

type DriverTarget = { bone: string; path: string; transform: string; space: string }
type Driver = {
  path: string
  index: number
  expression: string
  variables: { name: string; type: string; targets: DriverTarget[] }[]
}
type Bone = {
  name: string
  parent: string | null
  rest: number[]
  length: number
  inheritScale: string
  inheritRotation: boolean
  widgetTransform: string | null
  widgetOffset: number[]
  constraints: {
    type: string
    target: string
    influence: number
    track: string
    up: string
    targetZ: boolean
    ownerSpace: string
    targetSpace: string
  }[]
}
export type RigSource = {
  bones: Bone[]
  defaults: BlenderRigState['bones']
  widgets: BlenderRigWidget[]
  drivers: Driver[]
  cameraDrivers: Driver[]
  cameraParent: string
  cameraBasis: number[]
  sensorFit: string
  reference: BlenderRigResult
}
const C = new Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1)
const sourceOffsets = nativeRigOffsets.offsets as Record<string, Record<string, number[]>>
const vec = (a: number[]) => new Vector3(...a)
const quat = (a: number[]) => new Quaternion().setFromEuler(new Euler(a[0]!, a[1]!, a[2]!, 'ZYX'))
const components = rigMatrixComponents
const evaluations = new Map<string, BlenderRigResult>()
export function evaluateSourceCameraRig(request: BlenderRigRequest): BlenderRigResult {
  const key = JSON.stringify(request),
    cached = evaluations.get(key)
  if (cached) return cached
  const result = evaluate(request)
  if (evaluations.size >= 128) evaluations.delete(evaluations.keys().next().value!)
  evaluations.set(key, result)
  return result
}
function evaluate(request: BlenderRigRequest): BlenderRigResult {
  const source = cameraRigsSource[request.type]
  const objectWorld = C.clone()
    .invert()
    .multiply(new Matrix4().fromArray(request.worldMatrix ?? new Matrix4().toArray()))
    .multiply(C)
  const objectInverse = invertRigMatrix(objectWorld)
  const inWorld = (matrix: Matrix4) => objectWorld.clone().multiply(matrix)
  const values = structuredClone(source.defaults)
  for (const [name, patch] of Object.entries(request.bones ?? {}))
    if (values[name]) values[name] = structuredClone(patch)
  if (request.type === '2d' && request.projection === 'orthographic')
    values.Camera!.properties.rotation_shift = 1
  const definitions = new Map(source.bones.map((b) => [b.name, b])),
    world = new Map<string, Matrix4>(),
    edits = new Map<string, Matrix4>(),
    locations = new Map<string, Matrix4>(),
    working = new Set<string>()
  const focusSubject = (): Vector3 | null => {
    if (request.focusTarget) return transformRigPoint(vec(request.focusTarget), C.clone().invert())
    if (request.focusBone === '') return new Vector3()
    const name =
      request.focusBone !== undefined
        ? request.focusBone
        : request.type === '2d'
          ? 'DOF'
          : request.focusOnAim
            ? 'Aim'
            : null
    return name && definitions.has(name) ? new Vector3().setFromMatrixPosition(bone(name)) : null
  }
  const variable = (type: string, targets: DriverTarget[]): number => {
    const t = targets[0]!
    if (type === 'CONTEXT_PROP')
      return t.path.endsWith('_x') ? Math.round(1440 * request.aspect) : 1440
    if (type === 'SINGLE_PROP') {
      const match = t.path.match(/pose\.bones\["([^"]+)"\]\["([^"]+)"\]/)
      if (
        match?.[1] === 'Camera' &&
        match[2] === 'focus_distance' &&
        request.focusBone !== undefined
      ) {
        const subject = focusSubject()
        if (subject)
          return transformRigPoint(subject, objectWorld).distanceTo(
            new Vector3().setFromMatrixPosition(inWorld(bone('Camera'))),
          )
      }
      return match ? property(match[1]!, match[2]!) : 0
    }
    if (type === 'LOC_DIFF')
      return new Vector3()
        .setFromMatrixPosition(inWorld(bone(t.bone)))
        .distanceTo(new Vector3().setFromMatrixPosition(inWorld(bone(targets[1]!.bone))))
    if (type === 'TRANSFORMS') {
      if (t.space === 'TRANSFORM_SPACE') {
        const state = values[t.bone],
          axis = 'XYZ'.indexOf(t.transform.at(-1)!)
        return t.transform.startsWith('LOC_')
          ? (state?.location[axis] ?? 0)
          : t.transform.startsWith('ROT_')
            ? (state?.rotation[axis] ?? 0)
            : (state?.scale[axis] ?? 1)
      }
      const v = components(t.space === 'WORLD_SPACE' ? inWorld(bone(t.bone)) : bone(t.bone))
      if (t.transform === 'SCALE_AVG') return Math.cbrt(Math.abs(v.s.x * v.s.y * v.s.z))
      return v.p.getComponent('XYZ'.indexOf(t.transform.at(-1)!))
    }
    throw new Error(`Unsupported upstream driver variable ${type}`)
  }
  const expression = (driver: Driver) =>
    evaluateRigExpression(
      driver.expression,
      Object.fromEntries(driver.variables.map((v) => [v.name, variable(v.type, v.targets)])),
      !!request.focalRange &&
        (driver.path === 'lens' || driver.path.endsWith('["lens_without_breathing"]')),
    )
  const property = (name: string, key: string): number => {
    if (key === 'lens_without_breathing' && request.dollyDistance) {
      const driver = source.drivers.find((d) => d.path.endsWith('["lens_without_breathing"]'))!
      return evaluateRigExpression(
        '((distance * (lens + lens_offset) / dolly_distance ) / root_scale)',
        {
          ...Object.fromEntries(driver.variables.map((v) => [v.name, variable(v.type, v.targets)])),
          dolly_distance: request.dollyDistance,
        },
        !!request.focalRange,
      )
    }
    const driven = source.drivers.find((d) => d.path === `pose.bones["${name}"]["${key}"]`)
    return driven ? expression(driven) : (values[name]?.properties[key] ?? 0)
  }
  const bone = (name: string): Matrix4 => {
    const cached = world.get(name)
    if (cached) return cached
    if (working.has(name)) throw new Error(`Cyclic upstream rig dependency: ${name}`)
    working.add(name)
    const def = definitions.get(name)!,
      rest = new Matrix4().fromArray(def.rest)
    const state = values[name] ?? {
      location: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      properties: {},
    }
    const location = vec(state.location)
    source.drivers
      .filter((d) => d.path === `pose.bones["${name}"].location`)
      .forEach((d) => {
        location.setComponent(d.index, expression(d))
      })
    let edit = rest.clone(),
      locationMatrix = rest.clone()
    if (def.parent) {
      const parent = bone(def.parent),
        relative = new Matrix4().fromArray(sourceOffsets[request.type]![name]!)
      locationMatrix = parent.clone().multiply(relative)
      edit = locationMatrix.clone()
      if (def.inheritScale === 'NONE' || !def.inheritRotation) {
        const rotationParent = def.inheritRotation
          ? rigOrthonormalBasis(parent)
          : new Matrix4().fromArray(definitions.get(def.parent)!.rest)
        edit = rotationParent
          .multiply(relative)
          .setPosition(new Vector3().setFromMatrixPosition(locationMatrix))
      }
    }
    edits.set(name, edit.clone())
    locations.set(name, locationMatrix.clone())
    let m = edit
      .clone()
      .multiply(new Matrix4().compose(location, quat(state.rotation), vec(state.scale)))
    m.setPosition(transformRigPoint(location.clone(), locationMatrix))
    if (name === 'Aim' && request.target) {
      const target = transformRigPoint(vec(request.target), C.clone().invert())
      values.Aim!.location = transformRigPoint(
        target.clone(),
        invertRigMatrix(locationMatrix),
      ).toArray()
      m.setPosition(target)
    }
    for (const constraint of def.constraints) {
      const worldSpace = constraint.ownerSpace === 'WORLD'
      m = inWorld(m)
      if (!worldSpace) m.premultiply(objectInverse)
      const targetWorld = inWorld(bone(constraint.target)),
        target =
          constraint.targetSpace === 'WORLD' ? targetWorld : targetWorld.premultiply(objectInverse),
        a = components(m),
        b = components(target)
      let influence =
        name === 'MCH-DOF_Parent'
          ? (request.dofTracking ?? constraint.influence)
          : constraint.influence
      if (name === 'Camera')
        influence =
          request.type === '2d' ? 1 - property('Camera', 'rotation_shift') : request.tracking
      let constrained: Matrix4 | null = null
      if (constraint.type === 'COPY_LOCATION') constrained = m.clone().setPosition(b.p)
      else if (constraint.type === 'COPY_ROTATION') {
        a.q.copy(rigCopyRotation(target))
        a.s.setFromMatrixScale(m)
        if (m.determinant() < 0) a.s.negate()
      } else if (constraint.type === 'TRACK_TO') {
        a.s.setFromMatrixScale(m)
        const independentUp = name === 'Camera' && request.trackingUp
        const direction = b.p.clone().sub(a.p)
        const y = direction.clone().normalize()
        if (independentUp && direction.lengthSq() < 1e-18) constrained = m.clone()
        else {
          if (y.lengthSq() === 0) y.set(0, 0, -1)
          const up = independentUp
            ? vec(independentUp).transformDirection(C.clone().invert())
            : new Vector3().setFromMatrixColumn(target, 2)
          if (independentUp && !worldSpace) up.transformDirection(objectInverse)
          const z = up.addScaledVector(y, -up.dot(y) / y.lengthSq())
          if (independentUp && z.lengthSq() < 1e-12) {
            // At vertical aim, use the authored camera right axis rather than a near-zero up.
            const right = new Vector3().setFromMatrixColumn(m, 0)
            right.addScaledVector(y, -right.dot(y))
            if (right.lengthSq() < 1e-12) {
              right.set(Math.abs(y.x) < 0.9 ? 1 : 0, Math.abs(y.x) < 0.9 ? 0 : 1, 0)
              right.addScaledVector(y, -right.dot(y))
            }
            z.crossVectors(right.normalize(), y)
          }
          z.normalize()
          if (z.lengthSq() === 0) z.set(0, 1, 0)
          const x = y.clone().cross(z).normalize()
          const basis = new Matrix4().makeBasis(x, y, z).scale(a.s)
          constrained = m.clone()
          for (let column = 0; column < 3; column++)
            for (let row = 0; row < 3; row++)
              constrained.elements[column * 4 + row] = basis.elements[column * 4 + row]!
        }
      } else if (constraint.type === 'DAMPED_TRACK') {
        const direction = b.p.clone().sub(a.p).normalize(),
          axis = new Vector3().setFromMatrixColumn(m, 2).negate().normalize()
        if (direction.lengthSq() > 1e-12)
          constrained = new Matrix4()
            .makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(axis, direction))
            .multiply(m)
            .setPosition(a.p)
      } else throw new Error(`Unsupported upstream constraint ${constraint.type}`)
      m = blendRigMatrices(m, constrained ?? new Matrix4().compose(a.p, a.q, a.s), influence)
      if (!worldSpace) m = inWorld(m)
      m.premultiply(objectInverse)
    }
    working.delete(name)
    world.set(name, m)
    return m
  }
  if (request.target) bone('Aim')
  source.bones.forEach((b) => {
    bone(b.name)
  })
  const cameraWorld = bone(source.cameraParent)
    .clone()
    .multiply(new Matrix4().makeTranslation(0, definitions.get(source.cameraParent)!.length, 0))
    .multiply(new Matrix4().fromArray(source.cameraBasis))
  if (request.cameraOffsetMatrix)
    cameraWorld.multiply(new Matrix4().fromArray(request.cameraOffsetMatrix))
  const cameraProperties: Record<string, number> = {
    lens: 50,
    ortho_scale: request.orthographicHeight * Math.max(1, request.aspect),
    shift_x: 0,
    shift_y: 0,
  }
  for (const driver of source.cameraDrivers) cameraProperties[driver.path] = expression(driver)
  const horizontal = source.sensorFit === 'HORIZONTAL' || request.aspect >= 1
  const width = request.aspect,
    horizontalScale = horizontal ? 1 : 1 / width,
    verticalScale = horizontal ? width : 1
  // Drivers run after the authored lens, so the effective lens must be bounded here.
  const requestedLens = cameraProperties.lens!
  const lens = request.focalRange
      ? clampCameraFocalLength(requestedLens, request.focalRange)
      : Math.max(1, requestedLens),
    height = cameraProperties.ortho_scale! / (horizontal ? width : 1)
  const fov =
    (2 * Math.atan(request.sensorWidth / (2 * lens) / (horizontal ? width : 1)) * 180) / Math.PI
  const camera =
    request.projection === 'orthographic'
      ? new OrthographicCamera(
          (-height * width) / 2,
          (height * width) / 2,
          height / 2,
          -height / 2,
          0.1,
          1000,
        )
      : new PerspectiveCamera(fov, width, 0.1, 1000)
  const projection = camera.projectionMatrix.elements
  const shiftX = cameraProperties.shift_x! * horizontalScale,
    shiftY = cameraProperties.shift_y! * verticalScale
  if (request.projection === 'orthographic') {
    projection[12] = -2 * shiftX
    projection[13] = -2 * shiftY
  } else {
    projection[8] = 2 * shiftX
    projection[9] = 2 * shiftY
  }
  const widgets = source.widgets.map((widget) => {
    const def = definitions.get(widget.name)!,
      pose = bone(widget.name)
    const shape = bone(def.widgetTransform ?? def.name)
      .clone()
      .multiply(new Matrix4().fromArray(def.widgetOffset))
    return {
      ...widget,
      matrix: C.clone().multiply(shape).toArray(),
      boneMatrix: C.clone().multiply(pose).toArray(),
      editMatrix: C.clone().multiply(edits.get(widget.name)!).toArray(),
      locationMatrix: C.clone().multiply(locations.get(widget.name)!).toArray(),
    }
  })
  const distance = new Vector3()
    .setFromMatrixPosition(bone('Camera'))
    .distanceTo(new Vector3().setFromMatrixPosition(bone('Aim')))
  const subject = focusSubject()
  const focusCamera = inWorld(cameraWorld)
  const focus = subject
    ? Math.abs(
        transformRigPoint(subject.clone(), objectWorld)
          .sub(new Vector3().setFromMatrixPosition(focusCamera))
          .dot(new Vector3().setFromMatrixColumn(focusCamera, 2).normalize()),
      )
    : property('Camera', 'focus_distance')
  return {
    aspect: request.aspect,
    type: request.type,
    bones: values,
    boneMatrices: Object.fromEntries(
      source.bones.map(({ name }) => [name, C.clone().multiply(bone(name)).toArray()]),
    ),
    widgets,
    cameraMatrix: C.clone().multiply(cameraWorld).toArray(),
    projectionMatrix: projection.slice(),
    lens,
    lensWithoutBreathing:
      request.type === '2d' ? requestedLens : property('Camera', 'lens_without_breathing'),
    lensLimited:
      !!request.focalRange &&
      (!Number.isFinite(requestedLens) || Math.abs(lens - requestedLens) > 1e-8),
    focusDistance: Math.max(1e-5, focus),
    aperture: property('Camera', 'aperture_fstop'),
    dollyDistance: distance,
    sourceVersion: '1.9.0',
    blenderVersion: 'native source port',
  }
}
