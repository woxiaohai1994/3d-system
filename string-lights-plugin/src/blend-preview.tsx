'use client'
import { sceneRegistry } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Group } from 'three'
import { create } from 'zustand'
import { LightVisual } from './renderer'
import type { StringLightNode } from './schema'

export const useBlendPreview = create<{
  ownerId: string | null
  parentId?: string | null
  nodes: StringLightNode[]
}>(() => ({
  ownerId: null,
  nodes: [],
}))

export default function BlendPreview() {
  const preview = useBlendPreview()
  const group = useRef<Group>(null!)
  useFrame(() => {
    const parent = preview.parentId
      ? sceneRegistry.nodes.get(preview.parentId)
      : preview.ownerId
        ? sceneRegistry.nodes.get(preview.ownerId)?.parent
        : undefined
    if (parent && group.current) {
      parent.updateWorldMatrix(true, false)
      group.current.matrix.copy(parent.matrixWorld)
    }
  })
  useLayoutEffect(() => {
    group.current?.traverse((object) => {
      object.raycast = () => {}
    })
  }, [preview.nodes])
  if (!preview.ownerId) return null
  return (
    <group ref={group} matrixAutoUpdate={false} userData={{ excludeSurfaceQuery: true }}>
      {preview.nodes.map((node) => (
        <group key={node.id} position={node.position} rotation={node.rotation}>
          <LightVisual node={node} />
        </group>
      ))}
    </group>
  )
}
