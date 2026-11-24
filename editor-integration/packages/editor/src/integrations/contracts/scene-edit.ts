import type {
  AnyNode,
  AnyNodeId,
  Collection,
  CollectionId,
  SceneMaterial,
  SceneMaterialId,
  SceneSnapshot,
} from '@pascal-app/core'

export type SceneEditContext = {
  projectId: string
  sceneRevision: number
}

export type SceneRead = SceneEditContext & { scene: SceneSnapshot }

export type TemporaryNodeId = `$${string}`
export type SceneNodeReference = AnyNodeId | TemporaryNodeId
export type SceneNodeDraft = {
  type: AnyNode['type']
  id?: SceneNodeReference
  [field: string]: unknown
}

export type SceneEditOperation =
  | { op: 'create'; node: SceneNodeDraft; parentId?: SceneNodeReference }
  | { op: 'update'; id: SceneNodeReference; data: Record<string, unknown> }
  | { op: 'delete'; id: SceneNodeReference }
  | { op: 'transform'; id: SceneNodeReference; matrix: number[]; parentId?: SceneNodeReference }

export type ResolvedSceneEditOperation =
  | { op: 'create'; node: AnyNode; parentId?: AnyNodeId }
  | { op: 'update'; id: AnyNodeId; data: Partial<AnyNode> }
  | { op: 'delete'; id: AnyNodeId }
  | { op: 'transform'; id: AnyNodeId; matrix: number[]; parentId?: AnyNodeId }

export type SceneEditRequest = SceneEditContext & {
  requestId: string
  operations: SceneEditOperation[]
  resources?: SceneEditResources
}

export type SceneEditResources = {
  collections?: {
    set?: (Omit<Collection, 'id' | 'nodeIds' | 'controlNodeId'> & {
      id: CollectionId | `$${string}`
      nodeIds: SceneNodeReference[]
      controlNodeId?: SceneNodeReference
    })[]
    delete?: CollectionId[]
  }
  materials?: {
    set?: (Omit<SceneMaterial, 'id'> & { id: SceneMaterialId | `$${string}` })[]
    delete?: SceneMaterialId[]
  }
}

export type SceneResourceIdMaps = {
  collectionIdMap: Readonly<Record<`$${string}`, CollectionId>>
  materialIdMap: Readonly<Record<`$${string}`, SceneMaterialId>>
}

export type SceneResourceDiff = {
  collectionChanges: readonly {
    id: CollectionId
    before: Collection | null
    after: Collection | null
  }[]
  materialChanges: readonly {
    id: SceneMaterialId
    before: SceneMaterial | null
    after: SceneMaterial | null
  }[]
}

export type PreparedSceneEdits = Readonly<
  SceneEditContext &
    SceneResourceIdMaps &
    SceneResourceDiff & {
      requestId: string
      nodeIdMap: Readonly<Record<TemporaryNodeId, AnyNodeId>>
      changes: readonly { id: AnyNodeId; before: AnyNode | null; after: AnyNode | null }[]
    }
>

export type SceneEditReceipt = Readonly<
  SceneEditContext &
    SceneResourceIdMaps & {
      requestId: string
      nodeIdMap: Readonly<Record<TemporaryNodeId, AnyNodeId>>
      updatedIds: readonly AnyNodeId[]
      createdIds: readonly AnyNodeId[]
      deletedIds: readonly AnyNodeId[]
      collectionIds: readonly CollectionId[]
      materialIds: readonly SceneMaterialId[]
    }
>

export type SceneEditErrorCode =
  | 'DISPOSED'
  | 'WRONG_PROJECT'
  | 'STALE_PREVIEW'
  | 'BUSY'
  | 'READ_ONLY'
  | 'INVALID_INPUT'
  | 'INVALID_NODE'
  | 'UNSUPPORTED_FIELD'
  | 'MISSING_NODE'
  | 'REQUEST_CONFLICT'
  | 'INVALID_PREVIEW'
  | 'NO_CHANGES'
  | 'ID_CONFLICT'
  | 'INVALID_RELATION'
  | 'INVALID_RESOURCE'
  | 'INVALID_TRANSFORM'
  | 'UNSUPPORTED_TRANSFORM'
  | 'SINGULAR_TRANSFORM'
  | 'SHEAR_TRANSFORM'

export class SceneEditError extends Error {
  constructor(readonly code: SceneEditErrorCode) {
    super(code)
    this.name = 'SceneEditError'
  }
}
