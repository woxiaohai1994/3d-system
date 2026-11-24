import { expect, test } from 'bun:test'
import { act, create } from '@react-three/test-renderer'
import { createElement } from 'react'
import { Raycaster, Vector3 } from 'three'
import {
  ColumnNode,
  capturePointAttachment,
  resolvePointAttachment,
  nodeRegistry,
  registerNode,
} from '@pascal-app/core'
import { columnDefinition } from '../../packages/nodes/src/column/definition'
import { ColumnRenderer } from '../../packages/nodes/src/column/renderer'

test('round and faceted shaft attachments retain clearance against actual rendered meshes after resizing and shaping', async () => {
  const restore = nodeRegistry._snapshot()
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const savedAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  if (!nodeRegistry.has('column')) registerNode(columnDefinition as never)
  try {
    for (const crossSection of ['round', 'octagonal', 'sixteen-sided'] as const) {
      const node = ColumnNode.parse({
        crossSection,
        height: 3,
        radius: 0.4,
        baseHeight: 0.2,
        capitalHeight: 0.3,
        shaftProfile: 'bulged',
        shaftBulge: 0.1,
        shaftSegmentCount: 12,
        shaftTwistStep: 8,
        ringCount: 0,
        fluteCount: 0,
      })
      const renderer = await create(createElement(ColumnRenderer, { node }))
      try {
        const surface = (y: number, angle: number) => {
          const direction = new Vector3(Math.sin(angle), 0, Math.cos(angle))
          renderer.scene.instance.updateMatrixWorld(true)
          const ray = new Raycaster(
            direction.clone().multiplyScalar(5).setY(y),
            direction.clone().negate(),
          )
          const hit = ray.intersectObject(renderer.scene.instance, true)[0]
          expect(hit).toBeDefined()
          return { hit: hit!.point, direction }
        }
        const bindings = [0.7, 1.23, 2.15].map((y, i) => {
          const { hit, direction } = surface(y, 0.17 + i * 1.3)
          const point = hit.clone().addScaledVector(direction, 0.04).toArray()
          const binding = capturePointAttachment(node, point, { [node.id]: node })!
          expect(binding).toBeDefined()
          expect(
            new Vector3(...resolvePointAttachment(binding, { [node.id]: node })!).distanceTo(
              new Vector3(...point),
            ),
          ).toBeLessThan(1e-6)
          return JSON.parse(JSON.stringify(binding)) as typeof binding
        })
        const next = {
          ...node,
          height: 4.7,
          radius: 0.65,
          baseHeight: 0.4,
          capitalHeight: 0.5,
          shaftBulge: 0.25,
          shaftTwistStep: 13,
        }
        await act(async () => {
          await renderer.update(createElement(ColumnRenderer, { node: next }))
        })
        for (const binding of bindings) {
          const point = new Vector3(...resolvePointAttachment(binding, { [node.id]: next })!)
          const { hit } = surface(point.y, Math.atan2(point.x, point.z))
          expect(point.distanceTo(hit)).toBeCloseTo(0.04, 5)
          expect(
            resolvePointAttachment(binding, { [node.id]: { ...next, supportStyle: 'a-frame' } }),
          ).toBeNull()
          expect(
            resolvePointAttachment(binding, { [node.id]: { ...next, shaftSegmentCount: 24 } }),
          ).toBeNull()
          expect(
            resolvePointAttachment(binding, { [node.id]: { ...next, ringCount: 4 } }),
          ).toBeNull()
        }
        expect(capturePointAttachment(node, [0.5, 0.05, 0], { [node.id]: node })).toBeUndefined()
      } finally {
        await renderer.unmount()
      }
    }
  } finally {
    actGlobal.IS_REACT_ACT_ENVIRONMENT = savedAct
    restore()
  }
})

test('square and rectangular shafts use the rendered geometry for surface following, including corners and twist', async () => {
  const restore = nodeRegistry._snapshot()
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const savedAct = actGlobal.IS_REACT_ACT_ENVIRONMENT
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true
  if (!nodeRegistry.has('column')) registerNode(columnDefinition as never)
  try {
    for (const crossSection of ['square', 'rectangular'] as const) {
      for (const shaftCornerRadius of [0, 0.08]) {
        const node = ColumnNode.parse({
          crossSection,
          height: 3,
          width: 0.7,
          depth: crossSection === 'square' ? 0.7 : 0.4,
          baseStyle: 'none',
          capitalStyle: 'none',
          shaftCornerRadius,
          shaftProfile: 'bulged',
          shaftSegmentCount: 12,
          shaftBulge: 0.1,
          shaftTwistStep: 5,
          edgeSoftness: 0.025,
          ringCount: 0,
          fluteCount: 0,
        })
        const renderer = await create(createElement(ColumnRenderer, { node }))
        try {
          renderer.scene.instance.updateMatrixWorld(true)
          const bindings = [0.13, 0.75, 2.1, 3.8].map((angle, i) => {
            const direction = new Vector3(Math.sin(angle), 0, Math.cos(angle))
            const ray = new Raycaster(
              direction
                .clone()
                .multiplyScalar(5)
                .setY(0.61 + i * 0.5),
              direction.clone().negate(),
            )
            const hit = ray.intersectObject(renderer.scene.instance, true)[0]!
            expect(hit).toBeDefined()
            const normal = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld)
            const point = hit.point.clone().addScaledVector(normal, 0.025)
            const binding = capturePointAttachment(node, point.toArray(), { [node.id]: node })!
            expect(binding).toBeDefined()
            expect(
              new Vector3(...resolvePointAttachment(binding, { [node.id]: node })!).distanceTo(
                point,
              ),
            ).toBeLessThan(1e-6)
            return JSON.parse(JSON.stringify(binding)) as typeof binding
          })
          const next = {
            ...node,
            width: 1.1,
            depth: crossSection === 'square' ? 1.1 : 0.6,
            height: 4.5,
            shaftTwistStep: 9,
            shaftBulge: 0.2,
            shaftCornerRadius: shaftCornerRadius ? 0.12 : 0,
            edgeSoftness: 0.035,
          }
          await act(async () => {
            await renderer.update(createElement(ColumnRenderer, { node: next }))
          })
          renderer.scene.instance.updateMatrixWorld(true)
          for (const binding of bindings) {
            const point = new Vector3(...resolvePointAttachment(binding, { [node.id]: next })!)
            const mesh = renderer.scene.instance.children[0]!.children.find(
              (object) => object.type === 'Mesh',
            ) as import('three').Mesh
            expect(mesh).toBeDefined()
            const p = mesh.geometry.getAttribute('position')
            const face = Number(binding.parameters.face)
            const a = new Vector3().fromBufferAttribute(p, face * 3)
            const b = new Vector3().fromBufferAttribute(p, face * 3 + 1)
            const c = new Vector3().fromBufferAttribute(p, face * 3 + 2)
            const normal = b.sub(a).cross(c.sub(a)).normalize()
            const hit = new Raycaster(point, normal.negate(), 0, 0.1).intersectObject(mesh)[0]!
            expect(hit).toBeDefined()
            expect(hit.distance).toBeCloseTo(0.025, 5)
            expect(
              resolvePointAttachment(binding, { [node.id]: { ...next, crossSection: 'round' } }),
            ).toBeNull()
            expect(
              resolvePointAttachment(binding, { [node.id]: { ...next, shaftSegmentCount: 24 } }),
            ).toBeNull()
          }
        } finally {
          await renderer.unmount()
        }
      }
    }
  } finally {
    actGlobal.IS_REACT_ACT_ENVIRONMENT = savedAct
    restore()
  }
})
