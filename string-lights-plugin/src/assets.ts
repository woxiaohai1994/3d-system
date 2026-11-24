import type { AssetInput } from '@pascal-app/core'
import { create } from 'zustand'
import { BulbAsset } from './schema'

export type LightAssetInput = AssetInput & { availableMaterials?: string[]; stringLight?: boolean }
type CollectionHandler = (id: string, enabled: boolean) => Promise<void>
export const useLightAssets = create<{
  assets: LightAssetInput[]
  errors: Record<string, boolean>
  materials: Record<string, string[]>
  updateCollection: CollectionHandler | null
}>(() => ({ assets: [], errors: {}, materials: {}, updateCollection: null }))
export function setLightAssetCollectionHandler(updateCollection: CollectionHandler | null) {
  useLightAssets.setState({ updateCollection })
}
export function setAssetError(src: string, failed: boolean) {
  useLightAssets.setState((s) => ({ errors: { ...s.errors, [src]: failed } }))
}
export function setLightAssets(assets: LightAssetInput[]) {
  useLightAssets.setState({ assets })
}
export function asBulbAsset(asset: LightAssetInput) {
  return BulbAsset.parse({
    ...asset,
    id: asset.id ?? asset.src,
    connection: [0, 0, 0],
    emissionMaterials: [],
  })
}

export function setAssetMaterials(src: string, names: string[]) {
  const unique = [...new Set(names.filter(Boolean))]
  if (JSON.stringify(useLightAssets.getState().materials[src]) !== JSON.stringify(unique))
    useLightAssets.setState((s) => ({ materials: { ...s.materials, [src]: unique } }))
}
