import { expect, test } from 'bun:test'
import { SceneCameraNode, SiteNode } from '@pascal-app/core/schema'
import { apiGraphSchema } from './graph-schema'

test('API validates exclusive camera ownership and actual camera references without rewriting saved input', () => {
  const camera = SceneCameraNode.parse({}),
    site = SiteNode.parse({
      children: [camera.id],
      animation: { version: 2, shots: [{ id: 'shot_a', name: 'A', cameraId: camera.id }] },
    })
  const graph = { nodes: { [camera.id]: camera, [site.id]: site }, rootNodeIds: [site.id] }
  expect(apiGraphSchema.parse(graph)).toEqual(graph)
  expect(apiGraphSchema.safeParse({ ...graph, nodes: { [site.id]: site } }).success).toBe(false)
  const duplicate = SiteNode.parse({ ...site, id: 'site_second' })
  expect(
    apiGraphSchema.safeParse({ ...graph, nodes: { ...graph.nodes, [duplicate.id]: duplicate } })
      .success,
  ).toBe(false)
})
