import { BlenderRigRequest, CameraRig } from '../packages/core/src/schema/camera-rig'
import { SceneCameraNode } from '../packages/core/src/schema/nodes/scene-camera'
import { evaluateSourceCameraRig } from '../packages/viewer/src/lib/add-camera-rigs-runtime'
import { applyBlenderRigResult } from '../packages/viewer/src/lib/blender-camera-rig'
import {
  applySceneCameraProjection,
  sceneCameraWorldPose,
} from '../packages/editor/src/components/scene-camera/camera-math'
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'

const renderer = new WebGPURenderer({ antialias: true })
renderer.toneMapping = NoToneMapping
renderer.setPixelRatio(1)
document.body.style.margin = '0'
document.body.appendChild(renderer.domElement)
await renderer.init()

Object.assign(window, {
  renderRig: async (fixture: {
    request: unknown
    width: number
    height: number
    parentMatrix: number[] | null
    meshes: { vertices: number[][]; indices: number[]; color: [number, number, number] }[]
  }) => {
    const request = BlenderRigRequest.parse({
      ...(fixture.request as object),
      worldMatrix: fixture.parentMatrix ?? undefined,
    })
    const rig = CameraRig.parse({
      type: request.type,
      tracking: request.tracking,
      native: {
        source: 'add-camera-rigs@1.9.0',
        placement: new Matrix4().toArray(),
        sensorWidth: 36,
        bones: request.bones,
      },
    })
    const result = evaluateSourceCameraRig(request)
    const pose = applyBlenderRigResult(
      {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        verticalFov: 50,
        orthographicHeight: request.orthographicHeight,
        orbitDistance: 10,
      },
      rig,
      result,
    )
    const frame = SceneCameraNode.parse({
      ...pose,
      projection: request.projection,
      frameAspect: request.aspect,
      near: 0.1,
      far: 1000,
    })
    const camera =
      request.projection === 'perspective' ? new PerspectiveCamera() : new OrthographicCamera()
    const world = sceneCameraWorldPose(
      pose,
      fixture.parentMatrix ? new Matrix4().fromArray(fixture.parentMatrix) : undefined,
    )
    camera.position.copy(world.position)
    camera.quaternion.copy(world.quaternion)
    camera.updateMatrixWorld()
    renderer.setSize(fixture.width, fixture.height)
    // Render once to let WebGPU choose its camera coordinate system before applying the app projection.
    const scene = new Scene()
    scene.background = new Color(0, 0, 0)
    await renderer.renderAsync(scene, camera)
    applySceneCameraProjection(camera, { ...frame, viewCorrection: world.viewCorrection })
    for (const item of fixture.meshes) {
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(item.vertices.flat(), 3))
      geometry.setIndex(item.indices)
      scene.add(
        new Mesh(
          geometry,
          new MeshBasicMaterial({ color: new Color(...item.color), side: DoubleSide }),
        ),
      )
    }
    await renderer.renderAsync(scene, camera)
    const png = renderer.domElement.toDataURL('image/png')
    scene.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose()
        object.material.dispose()
      }
    })
    return {
      png,
      lens: result.lens,
      cameraMatrix: result.cameraMatrix,
      backend: renderer.backend.constructor.name,
    }
  },
})
