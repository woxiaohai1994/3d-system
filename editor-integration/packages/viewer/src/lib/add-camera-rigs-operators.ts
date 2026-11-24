// SPDX-License-Identifier: GPL-3.0-or-later
import type { CameraRig } from '@pascal-app/core'
import { SceneCameraMarker } from '@pascal-app/core'
import { Matrix4, Vector3 } from 'three'
import { sourceRigOperators } from './add-camera-rigs-operators-source'
import type { BlenderRigResult } from './blender-camera-rig'
import { rigBoneDecompose } from './rig-matrix'

class PyVector {
  constructor(
    readonly value: Vector3,
    readonly changed?: () => void,
  ) {}
  get length() {
    return this.value.length()
  }
}

class PyMatrix {
  constructor(
    readonly value: Matrix4,
    readonly changed?: (matrix: Matrix4) => void,
  ) {}
  to_translation() {
    return new PyVector(new Vector3().setFromMatrixPosition(this.value))
  }
  get translation() {
    const vector = new Vector3().setFromMatrixPosition(this.value)
    return new PyVector(vector, () => {
      this.value.setPosition(vector)
      this.changed?.(this.value)
    })
  }
}

function get(object: unknown, key: PropertyKey): unknown {
  if (object instanceof PyVector && typeof key === 'number') return object.value.getComponent(key)
  if (typeof object === 'string' && key === 'lower') return () => object.toLowerCase()
  const value = (object as Record<PropertyKey, unknown>)[key]
  return typeof value === 'function' ? value.bind(object) : value
}

function binary(op: string, left: unknown, right: unknown): unknown {
  if (left instanceof PyMatrix && right instanceof PyMatrix) {
    if (op === 'MatMult') return new PyMatrix(left.value.clone().multiply(right.value))
    if (op === 'Sub')
      return new PyMatrix(
        new Matrix4().fromArray(left.value.elements.map((v, i) => v - right.value.elements[i]!)),
      )
  }
  if (left instanceof PyVector) {
    if (right instanceof PyVector && (op === 'Add' || op === 'Sub'))
      return new PyVector(left.value.clone()[op === 'Add' ? 'add' : 'sub'](right.value))
    if (typeof right === 'number' && op === 'Mult')
      return new PyVector(left.value.clone().multiplyScalar(right))
  }
  if (typeof left === 'string') {
    if (op === 'Mod') return left.replace('%s', String(right))
    if (op === 'Add' && typeof right === 'string') return left + right
  }
  if (typeof left === 'number' && typeof right === 'number') {
    if (op === 'Add') return left + right
    if (op === 'Sub') return left - right
    if (op === 'Mult') return left * right
    if (op === 'Div') return left / right
  }
  throw new Error(`Unsupported Python operator ${op}`)
}

const program = sourceRigOperators({
  get,
  set: (object: Record<PropertyKey, unknown>, key: PropertyKey, value: unknown) => {
    object[key] = value
  },
  binary,
  inplace: (op: string, left: unknown, right: unknown) => {
    const value = binary(op, left, right)
    if (left instanceof PyVector && value instanceof PyVector) {
      left.value.copy(value.value)
      left.changed?.()
      return left
    }
    return value
  },
  compare: (op: string, left: unknown, right: unknown) => {
    if (op === 'Eq' || op === 'Is') return left === right
    if (op === 'IsNot') return left !== right
    if (op === 'In') {
      if (typeof right === 'string') return right.includes(String(left))
      if (Array.isArray(right)) return right.includes(left)
      return Object.hasOwn(right as object, left as PropertyKey)
    }
    throw new Error(`Unsupported Python comparison ${op}`)
  },
  next: (values: unknown[], ...fallback: unknown[]) => {
    if (values.length) return values[0]
    if (fallback.length) return fallback[0]
    throw new Error('StopIteration')
  },
  str: String,
  hasattr: (object: object, key: PropertyKey) => key in object,
  mathutils: {
    Matrix: {
      Translation: (value: number[] | PyVector) =>
        new PyMatrix(
          new Matrix4().makeTranslation(
            value instanceof PyVector ? value.value : new Vector3(...value),
          ),
        ),
    },
  },
})

export type SourceRigOperation =
  | 'set_dolly_zoom'
  | 'remove_dolly_zoom'
  | 'set_dof_bone'
  | 'shift_to_pivot'
  | 'swap_lens'

export type SourceRigSceneOperation = 'set_scene_camera' | 'add_marker_bind'
export type SourceRigScene = {
  cameraId: string
  activeCameraId: string | null
  frame: number
  cameraMarkers: SceneCameraMarker[]
}

function operatorContext(
  rig: CameraRig,
  result: BlenderRigResult,
  operation: SourceRigOperation | SourceRigSceneOperation,
  sceneData?: SourceRigScene,
) {
  const next = structuredClone(rig),
    bones = next.native!.bones
  const conversion = new Matrix4().makeRotationX(-Math.PI / 2)
  const inverse = conversion.clone().invert()
  const widget = (name: string) => result.widgets.find((w) => w.name === name)!
  const matrices = new Map(
    result.widgets.map((w) => [
      w.name,
      inverse.clone().multiply(new Matrix4().fromArray(w.boneMatrix)),
    ]),
  )
  // External aim binding is a host constraint; expose its evaluated location to bpy reads.
  if (next.target) {
    const aim = widget('Aim')
    bones.Aim!.location = new Vector3()
      .setFromMatrixPosition(new Matrix4().fromArray(aim.boneMatrix))
      .applyMatrix4(new Matrix4().fromArray(aim.locationMatrix).invert())
      .toArray()
  }
  const setMatrix = (name: string, matrix: Matrix4) => {
    if (name === 'Aim') next.target = null
    matrices.set(name, matrix.clone())
    const world = conversion.clone().multiply(matrix)
    const basis = new Matrix4().fromArray(widget(name).editMatrix).invert().multiply(world)
    bones[name] = {
      ...bones[name]!,
      location: new Vector3()
        .setFromMatrixPosition(world)
        .applyMatrix4(new Matrix4().fromArray(widget(name).locationMatrix).invert())
        .toArray(),
      ...rigBoneDecompose(basis),
    }
  }
  let expression: string = program.get_lens_expr(rig.dollyZoom ? rig.referenceDistance : null)
  const driver = {
    get expression() {
      return expression
    },
    set expression(value: string) {
      expression = value
      next.dollyZoom = value !== program.get_lens_expr()
      if (next.dollyZoom) {
        const template: string = program.get_lens_expr('__REFERENCE_DISTANCE__')
        const [prefix, suffix] = template.split('__REFERENCE_DISTANCE__')
        if (!value.startsWith(prefix!) || !value.endsWith(suffix!))
          throw new Error('Unsupported lens driver expression')
        next.referenceDistance = Number(value.slice(prefix!.length, -suffix!.length))
      }
    },
  }
  const poseBones = Object.fromEntries(
    Object.keys(bones).map((name) => {
      const data = {
        get matrix() {
          return new PyMatrix(matrices.get(name)!.clone(), (matrix) => setMatrix(name, matrix))
        },
        set matrix(value: PyMatrix) {
          setMatrix(name, value.value)
        },
        get matrix_basis() {
          return new PyMatrix(new Matrix4().makeTranslation(...bones[name]!.location))
        },
        color: { palette: 'DEFAULT' },
      }
      return [
        name,
        new Proxy(data, {
          get: (target, key, receiver) => {
            if (key === 'lens_without_breathing') return result.lensWithoutBreathing
            if (typeof key === 'string' && key in bones[name]!.properties)
              return bones[name]!.properties[key]
            return Reflect.get(target, key, receiver)
          },
          set: (target, key, value, receiver) => {
            if (typeof key === 'string' && key in bones[name]!.properties) {
              bones[name]!.properties[key] = value
              return true
            }
            return Reflect.set(target, key, value, receiver)
          },
        }),
      ]
    }),
  )
  const camera = {
    id: sceneData?.cameraId ?? '',
    type: 'CAMERA',
    data: { type: result.projectionMatrix[15] === 1 ? 'ORTHO' : 'PERSP' },
  }
  const object = {
    type: 'ARMATURE',
    name: `${rig.type}_Rig`,
    rig_id: `${rig.type}_Rig`,
    children: [camera],
    pose: { bones: poseBones },
    animation_data: {
      drivers: [{ data_path: 'pose.bones["Camera"]["lens_without_breathing"]', driver }],
    },
    acr_focus_object: '',
    set acr_focus_subtarget(bone: string) {
      next.focus = { kind: 'rig', bone }
    },
  }
  const sceneChanges = {
    activeCameraId: sceneData?.activeCameraId ?? null,
    cameraMarkers: structuredClone(sceneData?.cameraMarkers ?? []),
  }
  const context = {
    active_object: object,
    scene: {
      get camera() {
        return sceneChanges.activeCameraId === camera.id ? camera : null
      },
      set camera(value: typeof camera | null) {
        sceneChanges.activeCameraId = value?.id ?? null
      },
      frame_current: sceneData?.frame ?? 0,
      timeline_markers: {
        new: (name: string, { frame }: { frame: number }) => {
          const marker = SceneCameraMarker.parse({ name, frame })
          sceneChanges.cameraMarkers.push(marker)
          return {
            set camera(value: typeof camera | null) {
              marker.cameraId = value?.id ?? null
            },
          }
        },
      },
    },
  }
  const handler =
    program.operators[`add_camera_rigs.${operation}` as keyof typeof program.operators]
  return { next, handler, context, sceneChanges }
}

export function pollSourceRigOperator(
  rig: CameraRig,
  result: BlenderRigResult,
  operation: SourceRigOperation | SourceRigSceneOperation,
  scene?: SourceRigScene,
) {
  const { handler, context } = operatorContext(rig, result, operation, scene)
  let reason = ''
  const enabled = Boolean(
    handler.poll(
      {
        poll_message_set: (message: string) => {
          reason = message
        },
      },
      context,
    ),
  )
  return { disabled: !enabled, reason }
}

export function executeSourceRigSceneOperator(
  rig: CameraRig,
  result: BlenderRigResult,
  operation: SourceRigSceneOperation,
  scene: SourceRigScene,
) {
  const { handler, context, sceneChanges } = operatorContext(rig, result, operation, scene)
  const status = handler.execute({}, context)
  if (!status.includes('FINISHED')) throw new Error(`Source operator failed: ${operation}`)
  return sceneChanges
}

export function executeSourceRigOperator(
  rig: CameraRig,
  result: BlenderRigResult,
  operation: SourceRigOperation,
  lens?: number,
): CameraRig {
  const { next, handler, context } = operatorContext(rig, result, operation)
  const status = handler.execute({ camera_lens: lens }, context)
  if (!status.includes('FINISHED')) throw new Error(`Source operator failed: ${operation}`)
  return next
}
