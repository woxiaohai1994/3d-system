'use client'
import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { Matrix4, Vector3 } from 'three'
import type { Vec3 } from './schema'
import { useText } from './controls'
import type { useLightDraft } from './store'

export function DrawingFeedback({
  points,
  frame = new Matrix4(),
  feedback,
}: {
  points: Vec3[]
  frame?: Matrix4
  feedback: ReturnType<typeof useLightDraft.getState>['feedback']
}) {
  const view = useEditor((s) => s.viewMode)
  const target = useScene((s) =>
    feedback?.targetId ? s.nodes[feedback.targetId as AnyNodeId] : null,
  )
  const t = useText()
  if (view === '2d' || typeof document === 'undefined') return null
  return (
    <>
      {points.map((point, index) => (
        <Html
          key={index}
          position={new Vector3(...point).applyMatrix4(frame)}
          center
          zIndexRange={[30, 20]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            data-light-draft-point={index + 1}
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-primary text-xs font-semibold text-primary-foreground shadow-sm"
          >
            {index + 1}
          </div>
        </Html>
      ))}
      {feedback && (
        <Html position={feedback.point} zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
          <div className="relative">
            <div className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary shadow-sm" />
            <div
              data-testid="light-placement-feedback"
              className="ml-4 mt-3 w-max max-w-56 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground shadow-sm"
            >
              {target
                ? target.name || t('物体表面', 'Object surface')
                : t('悬空挂点', 'Free support')}{' '}
              · {feedback.height.toFixed(2)} m
            </div>
          </div>
        </Html>
      )}
    </>
  )
}
