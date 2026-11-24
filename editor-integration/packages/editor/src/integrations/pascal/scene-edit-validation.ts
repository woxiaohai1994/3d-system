import { type AnyNode, nodeRegistry } from '@pascal-app/core'
import { parseNode } from '@pascal-app/core/schema'
import { SceneEditError } from '../contracts/scene-edit'

export function sceneValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sceneValuesEqual(value, right[index]))
    )
  const record = left as Record<string, unknown>
  const other = right as Record<string, unknown>
  return (
    Object.keys(record).length === Object.keys(other).length &&
    Object.keys(record).every(
      (key) => Object.hasOwn(other, key) && sceneValuesEqual(record[key], other[key]),
    )
  )
}

export function validateData(
  data: unknown,
  budget: { values: number; text: number },
): asserts data is Record<string, unknown> {
  function visit(value: unknown, depth: number): void {
    if (--budget.values < 0 || depth > 32) throw new SceneEditError('INVALID_INPUT')
    if (value === null || typeof value === 'boolean' || value === undefined) return
    if (typeof value === 'string') {
      budget.text -= value.length
      if (value.length > 64 * 1024 || budget.text < 0) throw new SceneEditError('INVALID_INPUT')
      return
    }
    if (typeof value === 'number' && Number.isFinite(value)) return
    if (typeof value !== 'object' || value === null) throw new SceneEditError('INVALID_INPUT')
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
      throw new SceneEditError('INVALID_INPUT')
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') throw new SceneEditError('INVALID_INPUT')
      budget.text -= key.length
      if (budget.text < 0) throw new SceneEditError('INVALID_INPUT')
      const descriptor = descriptors[key]!
      if (['__proto__', 'constructor', 'prototype'].includes(key) || !('value' in descriptor)) {
        throw new SceneEditError('INVALID_INPUT')
      }
      visit(descriptor.value, depth + 1)
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new SceneEditError('INVALID_INPUT')
  }
  visit(data, 0)
}

export function merge(node: AnyNode, data: Record<string, unknown>): AnyNode {
  const candidate: Record<string, unknown> = { ...node, ...data }
  for (const key of Object.keys(data)) if (data[key] === undefined) delete candidate[key]
  return candidate as AnyNode
}

export function validateNode(node: AnyNode, previous?: AnyNode): AnyNode {
  const schema = nodeRegistry.get(node.type)?.schema
  const result = schema ? schema.safeParse(node) : parseNode(node)
  if (!result.success) {
    // Loading preserves unsupported animation documents; unrelated edits must preserve them too.
    if (
      node.type === 'site' &&
      previous?.type === 'site' &&
      node.id === previous.id &&
      node.animation !== undefined &&
      sceneValuesEqual(node.animation, previous.animation) &&
      result.error.issues.every(({ path }) => path[0] === 'animation')
    ) {
      const { animation, ...rest } = node
      return { ...validateNode(rest as AnyNode), animation } as AnyNode
    }
    console.warn(
      '[SceneEdit] Invalid node',
      JSON.stringify({
        id: node.id,
        type: node.type,
        issues: result.error.issues.map(({ path, message }) => ({ path, message })),
      }),
    )
    throw new SceneEditError('INVALID_NODE')
  }
  const parsed = result.data as AnyNode
  if (parsed.id !== node.id || parsed.type !== node.type || parsed.parentId !== node.parentId) {
    throw new SceneEditError('INVALID_NODE')
  }
  return parsed
}
