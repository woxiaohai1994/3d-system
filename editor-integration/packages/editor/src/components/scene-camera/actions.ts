import {
  type AnyNodeId,
  type CameraRig,
  emitter,
  SceneCameraNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Euler, Quaternion, Vector3 } from 'three'
import useEditor from '../../store/use-editor'
import { animationData, animationSite } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { cameraAspect, cameraFov, sceneCameraAspect } from './camera-math'
import { selectMotionCamera } from './motion-state'
import { createSourceRigCamera } from './rig-create-source'
import { useRigEditor } from './rig-state'
import { syncSceneCameraReference } from './scene-camera-state'
import { openCameraStudio, useCameraStudio } from './store'
import { cameraFromViewport, currentViewportSource } from './viewport-source'

export function alignCameraToView(
  node: SceneCameraNode,
  outputRatio?: SceneCameraNode['aspectRatio'],
) {
  const source = currentViewportSource()
  if (!source || useScene.getState().readOnly) return false
  const parent = node.parentId ? sceneRegistry.nodes.get(node.parentId) : undefined
  parent?.updateWorldMatrix(true, false)
  const patch = cameraFromViewport(
    source,
    node,
    parent?.matrixWorld,
    outputRatio ? cameraAspect(outputRatio) : undefined,
  )
  if (outputRatio) Object.assign(patch, { aspectRatio: outputRatio, frameAspect: null })
  useScene.getState().updateNode(node.id, patch)
  return true
}

export function addSceneCamera(name: string) {
  return createSceneCamera(name)
}

export function addSceneCameraRig(type: CameraRig['type'], name: string) {
  const node = createSceneCamera(name, type)
  if (node)
    useRigEditor.setState({
      control: '',
      selectedControls: [],
      selectionCameraId: node.id,
      poseCameraId: null,
    })
  return node
}

function createSceneCamera(name: string, rigType?: CameraRig['type']) {
  const scene = useScene.getState()
  if (scene.readOnly) return
  const session = useSceneAnimation.getState()
  const animation = animationData()
  const shot = animation.shots.find((s) => s.id === session.shotId)
  const cameraExists =
    !!shot?.cameraId && scene.nodes[shot.cameraId as SceneCameraNode['id']]?.type === 'scene-camera'
  if (session.open && (session.workspace === 'film' || cameraExists)) {
    useSceneAnimation.setState({ message: '每个相机工作区最多一台相机，请先新建工作区' })
    return
  }
  if (session.open && shot?.cameraId && !cameraExists) {
    useSceneAnimation.setState({
      message: '此工作区的相机已删除，请删除失效工作区后新建；旧成片引用会在删除前显示。',
    })
    return
  }
  const source = rigType ? null : currentViewportSource()
  if (!rigType && !source) return
  useEditor.getState().setTool(null)
  useEditor.getState().setMode('select')
  const selection = useViewer.getState().selection
  const parentId =
    selection.levelId ?? Object.values(scene.nodes).find((n) => n.type === 'level')?.id ?? null
  const parent = parentId ? sceneRegistry.nodes.get(parentId) : undefined
  parent?.updateWorldMatrix(true, false)
  const cameras = Object.values(scene.nodes).filter((n) => n.type === 'scene-camera')
  const names = new Set(cameras.map((camera) => camera.name))
  let number = cameras.length + 1
  while (names.has(`${name} ${number}`)) number++
  const node = SceneCameraNode.parse({
    ...(rigType
      ? createSourceRigCamera(
          rigType,
          useRigEditor.getState().cursor,
          animation.aspect,
          parent?.matrixWorld,
        )
      : cameraFromViewport(source!, SceneCameraNode.parse({}), parent?.matrixWorld)),
    name: `${name} ${number}`,
    parentId,
  })
  const site = animationSite()
  if (rigType && site && !syncSceneCameraReference()) return
  scene.applyNodeChanges({
    create: [{ node, parentId: parentId as AnyNodeId | undefined }],
    update:
      site && (rigType || (shot && session.open))
        ? [
            {
              id: site.id,
              data: {
                animation: {
                  ...animation,
                  ...(rigType ? { activeCameraId: node.id } : {}),
                  shots:
                    shot && session.open
                      ? animation.shots.map((s) =>
                          s.id === shot.id ? { ...s, cameraId: node.id } : s,
                        )
                      : animation.shots,
                },
              },
            },
          ]
        : [],
  })
  if (rigType && site)
    useSceneAnimation.setState({
      sceneCameraOverride: {
        frame: Math.trunc(session.time * animation.fps + 1e-7),
        cameraId: node.id,
      },
    })
  if (session.open) selectMotionCamera(node.id)
  useViewer.getState().setSelection({ selectedIds: [node.id] })
  openCameraStudio(node.id)
  return node
}

export function viewThroughCamera(node: SceneCameraNode) {
  const object = sceneRegistry.nodes.get(node.id)
  const position = new Vector3(...node.position)
  const quaternion = new Quaternion().setFromEuler(new Euler(...node.rotation))
  if (object) {
    object.updateWorldMatrix(true, false)
    object.getWorldPosition(position)
    object.getWorldQuaternion(quaternion)
  }
  const target = new Vector3(0, 0, -node.orbitDistance).applyQuaternion(quaternion).add(position)
  emitter.emit('camera-controls:apply-pose', {
    position: position.toArray(),
    target: target.toArray(),
    projection: node.projection,
    fov: cameraFov(node),
    ...(node.projection === 'orthographic'
      ? { viewWidth: node.orthographicHeight * sceneCameraAspect(node) }
      : {}),
  })
  openCameraStudio(node.id)
}

export function selectCameraTransform(node: SceneCameraNode, mode?: 'translate' | 'rotate') {
  useEditor.getState().setTool(null)
  useEditor.getState().setMode('select')
  useViewer.getState().setSelection({ selectedIds: [node.id] })
  if (mode) useCameraStudio.setState({ transformMode: mode })
}
