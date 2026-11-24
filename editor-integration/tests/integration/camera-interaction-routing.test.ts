import { expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  hasRegistry3DMoveTool,
  isRegistryMovable,
  nodeRegistry,
  registerNode,
  SceneCameraNode,
} from '@pascal-app/core'
import { sceneCameraDefinition } from '../../packages/nodes/src/scene-camera/definition'
import { canDirectMoveNode, canDirectRotateNode } from '../../packages/editor/src/lib/direct-manipulation'
import { collectParticipants } from '../../packages/editor/src/components/editor/group-transform-shared'

test('camera selection never starts the 2D or 3D model placement tool', () => {
  if (!nodeRegistry.has('scene-camera')) registerNode(sceneCameraDefinition as unknown as AnyNodeDefinition)
  const camera = SceneCameraNode.parse({})
  expect(isRegistryMovable(camera.type)).toBe(false)
  expect(hasRegistry3DMoveTool(camera.type)).toBe(false)
  expect(canDirectMoveNode(camera)).toBe(false)
  expect(canDirectRotateNode(camera)).toBe(false)
})
test('mixed building selection moves the model without moving the camera', () => {
  const camera = SceneCameraNode.parse({ parentId: 'level_test' })
  const model = {
    id: 'item_test',
    type: 'item',
    parentId: 'level_test',
    position: [1, 2, 3],
    rotation: [0, 0, 0],
  } as unknown as AnyNode
  const result = collectParticipants(
    [camera.id, model.id],
    { [camera.id]: camera, [model.id]: model },
    'level_test',
  )
  expect(result.starts.map((p) => p.id)).toEqual([model.id])
})
