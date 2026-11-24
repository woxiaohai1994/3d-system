import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core'
import { Mesh, Vector3 } from 'three/webgpu'
import { getWallHideState } from './wall-cutout'

const node = WallNode.parse({
  start: [0, 0],
  end: [4, 0],
  frontSide: 'interior',
  backSide: 'interior',
})
const direction = new Vector3(0, 0, -1)

describe('getWallHideState', () => {
  test('full height and down retain explicit semantics', () => {
    expect(getWallHideState(node, new Mesh(), 'up', direction)).toBe(false)
    expect(getWallHideState(node, new Mesh(), 'down', direction)).toBe(true)
  })
  test('cutaway matches resolved whole-wall visibility regardless of facing or side labels', () => {
    const mesh = new Mesh()
    expect(getWallHideState(node, mesh, 'cutaway', direction)).toBe(false)
    mesh.userData.wallCutawayHidden = true
    expect(getWallHideState(node, mesh, 'cutaway', direction)).toBe(true)
    mesh.rotation.y = Math.PI
    expect(getWallHideState(node, mesh, 'cutaway', direction)).toBe(true)
    mesh.userData.wallCutawayHidden = false
    expect(getWallHideState(node, mesh, 'cutaway', direction)).toBe(false)
  })
})
