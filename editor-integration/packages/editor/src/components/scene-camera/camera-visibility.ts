import type { Object3D } from 'three'

export function hideSceneCameraHelpers(scene: Object3D) {
  const visibility = new Map<Object3D, boolean>()
  const raycasts = new Map<Object3D, Object3D['raycast']>()
  // Invisible camera bodies still intercept scene selection in Three's raycaster.
  const blockedRaycast: Object3D['raycast'] = () => {}
  scene.traverse((object) => {
    if (!object.userData.cameraHelper) return
    visibility.set(object, object.visible)
    object.visible = false
    object.traverse((child) => {
      if (!raycasts.has(child)) raycasts.set(child, child.raycast)
      child.raycast = blockedRaycast
    })
  })
  return () => {
    for (const [object, visible] of visibility) object.visible = visible
    for (const [object, raycast] of raycasts)
      if (object.raycast === blockedRaycast) object.raycast = raycast
    visibility.clear()
    raycasts.clear()
  }
}

export function createSceneCameraBodyVisibility() {
  const visibility = new Map<Object3D, boolean>(),
    raycasts = new Map<Object3D, Object3D['raycast']>()
  // Three's raycaster ignores Object3D.visible, including invisible ancestors.
  const blockedRaycast: Object3D['raycast'] = () => {}
  const restore = () => {
    for (const [object, visible] of visibility) object.visible = visible
    for (const [object, raycast] of raycasts)
      if (object.raycast === blockedRaycast) object.raycast = raycast
    visibility.clear()
    raycasts.clear()
  }
  return {
    sync(root: Object3D | undefined) {
      const bodies = new Set<Object3D>(),
        targets = new Set<Object3D>()
      root?.traverse((object) => {
        if (!object.userData.sceneCameraBody && !object.userData.sceneCameraSourceFrame) return
        if (object.userData.sceneCameraBody) bodies.add(object)
        object.traverse((child) => targets.add(child))
      })
      for (const [object, visible] of visibility)
        if (!bodies.has(object)) {
          object.visible = visible
          visibility.delete(object)
        }
      for (const [object, raycast] of raycasts)
        if (!targets.has(object)) {
          if (object.raycast === blockedRaycast) object.raycast = raycast
          raycasts.delete(object)
        }
      for (const object of bodies) {
        if (!visibility.has(object)) visibility.set(object, object.visible)
        object.visible = false
      }
      for (const object of targets) {
        if (object.raycast !== blockedRaycast) raycasts.set(object, object.raycast)
        object.raycast = blockedRaycast
      }
    },
    restore,
  }
}
