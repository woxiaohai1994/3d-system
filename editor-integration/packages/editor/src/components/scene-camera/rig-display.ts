import { type SceneCameraNode, getEffectiveNode, useScene } from '@pascal-app/core'
import { z } from 'zod'

export const rigGuideLabels = {
  safe: ['安全框', 'Safe areas'],
  center: ['中心线', 'Center'],
  diagonal: ['对角线', 'Center diagonal'],
  thirds: ['三分线', 'Thirds'],
  golden: ['黄金分割', 'Golden ratio'],
  golden_a: ['黄金三角 A', 'Golden triangle A'],
  golden_b: ['黄金三角 B', 'Golden triangle B'],
  harmony_a: ['和谐三角 A', 'Harmony triangle A'],
  harmony_b: ['和谐三角 B', 'Harmony triangle B'],
} as const
export type RigGuide = keyof typeof rigGuideLabels
const RigDisplay = z.object({
  limits: z.boolean().default(false),
  passepartout: z.boolean().default(true),
  opacity: z.number().finite().min(0).max(1).default(0.5),
  guides: z.array(z.enum(Object.keys(rigGuideLabels) as [RigGuide, ...RigGuide[]])).default([]),
})
const metadataKey = 'editor.cameraRigDisplay'
export function rigDisplay(node: SceneCameraNode) {
  const parsed = RigDisplay.safeParse(getEffectiveNode(node).metadata[metadataKey] ?? {})
  return parsed.success ? parsed.data : RigDisplay.parse({})
}
export function updateRigDisplay(
  node: SceneCameraNode,
  values: Partial<z.infer<typeof RigDisplay>>,
) {
  if (useScene.getState().readOnly) return
  const current = useScene.getState().nodes[node.id]
  if (current?.type !== 'scene-camera') return
  useScene.getState().updateNode(node.id, {
    metadata: {
      ...current.metadata,
      [metadataKey]: RigDisplay.parse({ ...rigDisplay(current), ...values }),
    },
  })
}
