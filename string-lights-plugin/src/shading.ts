import {
  createDefaultMaterial,
  createSurfaceRoleMaterial,
  type ColorPreset,
  type RenderShading,
} from '@pascal-app/viewer'
import type { Mesh, Object3D } from 'three'
import type { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'

export type LightDisplayMaterial = MeshLambertNodeMaterial &
  Pick<MeshStandardNodeMaterial, 'emissiveNode'>

export function applyLightShading(
  group: Object3D,
  shading: RenderShading,
  textures: boolean,
  colorPreset: ColorPreset,
  sceneTheme: string,
) {
  const replacements: Array<{ mesh: Mesh; original: Mesh['material'] }> = []
  if (!textures || shading === 'solid')
    group.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      const source = mesh.material as MeshStandardNodeMaterial
      const material = (
        !textures
          ? createSurfaceRoleMaterial('furnishing', colorPreset, source.side, sceneTheme).clone()
          : createDefaultMaterial(`#${source.color.getHexString()}`, 0.8, 'solid', source.side)
      ) as LightDisplayMaterial
      if (textures) material.map = source.map
      material.transparent = source.transparent
      material.opacity = source.opacity
      material.alphaTest = source.alphaTest
      material.emissive.copy(source.emissive)
      material.emissiveIntensity = source.emissiveIntensity
      material.emissiveMap = source.emissiveMap
      // The attribute is animated on the geometry; every display material must keep reading it.
      material.emissiveNode = source.emissiveNode
      replacements.push({ mesh, original: mesh.material })
      mesh.material = material
    })
  return () => {
    for (const replacement of replacements) {
      ;(replacement.mesh.material as MeshLambertNodeMaterial).dispose()
      replacement.mesh.material = replacement.original
    }
  }
}
