import { animationData, commitSceneAnimation } from '../scene-animation/document'
import { useSceneAnimation } from '../scene-animation/store'
export function MotionSceneControls() {
  const animation = animationData(),
    state = useSceneAnimation()
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      项目画幅
      <select
        aria-label="视频画幅"
        className="rounded border border-border bg-background p-1"
        value={animation.aspect}
        disabled={state.exporting}
        onChange={(e) => commitSceneAnimation({ ...animation, aspect: Number(e.target.value) })}
      >
        {[
          16 / 9,
          9 / 16,
          1,
          4 / 3,
          ...(![16 / 9, 9 / 16, 1, 4 / 3].includes(animation.aspect) ? [animation.aspect] : []),
        ].map((v, i) => (
          <option key={v} value={v}>
            {['16:9', '9:16', '1:1', '4:3'][i] ?? v.toFixed(3)}
          </option>
        ))}
      </select>
    </label>
  )
}
