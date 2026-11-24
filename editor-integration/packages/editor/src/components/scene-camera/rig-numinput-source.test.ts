import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  applyNumInput,
  handleNumInput,
  hasNumInput,
  initNumInput,
  NUM_AFFECT_ALL,
  NUM_NULL_ONE,
  type SourceNumInput,
  type SourceNumInputEvent,
  sourceNumInputHashes,
} from './rig-numinput-source'

const root = new URL('../../../../../vendor/', import.meta.url)
type Vec3 = [number, number, number]
type Snapshot = Pick<
  SourceNumInput,
  'idx' | 'idx_max' | 'str' | 'str_cur' | 'flag' | 'val_flag' | 'val' | 'val_org'
> & {
  event?: SourceNumInputEvent
  handled: boolean
  result: Vec3
  applied: boolean
  hasInput: boolean
}
type Scenario = {
  name: string
  kind: 'translate' | 'rotate' | 'scale'
  idxMax: number
  affectAll: boolean
  nullOne: boolean
  initialValues: Vec3
  initial: Snapshot
  events: (Snapshot & { event: SourceNumInputEvent; handled: boolean })[]
}
const fixture = JSON.parse(
  readFileSync(new URL('blender-numinput/fixtures.json', root), 'utf8'),
) as {
  scenarios: Scenario[]
}

test('vendored default NumInput and cursor bodies retain their recorded source hashes', () => {
  for (const [path, hash] of Object.entries(sourceNumInputHashes))
    expect(
      createHash('sha256')
        .update(readFileSync(new URL(path, root)))
        .digest('hex'),
    ).toBe(hash)
})

test('the original C++ state machine and C cursor reproduce the frozen oracle', () => {
  const run = Bun.spawnSync([
    'python3',
    fileURLToPath(new URL('blender-numinput/generate_fixtures.py', root)),
    '--check',
  ])
  expect(run.exitCode).toBe(0)
}, 30000)

function snapshot(
  n: SourceNumInput,
  result: Vec3,
  applied: boolean,
): Omit<Snapshot, 'handled' | 'event'> {
  const { idx, idx_max, str, str_cur, flag, val_flag, val, val_org } = n
  return {
    idx,
    idx_max,
    str,
    str_cur,
    flag,
    val_flag,
    val,
    val_org,
    result,
    applied,
    hasInput: hasNumInput(n),
  }
}
for (const scenario of fixture.scenarios)
  test(`native default input fixture: ${scenario.name}`, () => {
    const n = initNumInput(scenario.kind === 'rotate')
    n.idx_max = scenario.idxMax
    if (scenario.affectAll) n.flag |= NUM_AFFECT_ALL
    if (scenario.nullOne) n.val_flag.fill(NUM_NULL_ONE)
    let result = scenario.initialValues.map(Math.fround) as Vec3
    const firstApplied = applyNumInput(n, result)
    expect({ handled: false, ...snapshot(n, result, firstApplied) }).toEqual(scenario.initial)
    for (const expected of scenario.events) {
      const handled = handleNumInput(n, expected.event)
      result = scenario.initialValues.map(Math.fround) as Vec3
      const applied = applyNumInput(n, result)
      expect({ event: expected.event, handled, ...snapshot(n, result, applied) }).toEqual(expected)
    }
  })
