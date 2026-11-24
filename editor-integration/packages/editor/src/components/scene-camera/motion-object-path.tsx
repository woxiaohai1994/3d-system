import { objectTracks, sceneRegistry } from '@pascal-app/core'
import { sampleObjectMotion } from '@pascal-app/viewer'
import { Vector3 } from 'three'
import { animationData } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
import { useObjectMotion } from './motion-object-store'
import { objectTrackValid } from './motion-objects'
import { MotionPath, SinglePathNode } from './motion-path'
import { objectPathData } from './motion-path-data'

export function MotionObjectPath() {
  const id = useObjectMotion((s) => s.nodeId),
    state = useSceneAnimation()
  const track = objectTracks(animationData()).find((t) => t.nodeId === id)
  if (!track || !objectTrackValid(track) || state.exporting) return null
  const parent = sceneRegistry.nodes.get(track.nodeId)?.parent
  parent?.updateWorldMatrix(true, false)
  if (track.points.length === 1) {
    const point = track.points[0]!,
      position = new Vector3(...point.position)
    return (
      <SinglePathNode
        pointId={point.id}
        position={parent ? parent.localToWorld(position) : position}
      />
    )
  }
  return (
    <group userData={{ cameraHelper: true }}>
      {objectPathData(track).segments.map((segment, index) => {
        const a = track.points[index]!,
          b = track.points[index + 1]!
        const points = Array.from({ length: 65 }, (_, i) => {
          const v = new Vector3(
            ...sampleObjectMotion(track, a.time + ((b.time - a.time) * i) / 64).position,
          )
          return parent ? parent.localToWorld(v) : v
        })
        return (
          <MotionPath
            key={segment.id}
            segmentId={segment.id}
            points={points}
            selected={!!state.segmentId && (state.pathSelected || state.segmentId === segment.id)}
          />
        )
      })}
    </group>
  )
}
