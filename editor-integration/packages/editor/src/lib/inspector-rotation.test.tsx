import { expect, test } from 'bun:test'
import { ItemNode } from '@pascal-app/core'
import { hasInspectorRotation, isRotationLabel } from './inspector-rotation'

const Control = (_props: any) => null
const node = ItemNode.parse({
  asset: { id: 'test', name: 'Test', category: 'furniture', thumbnail: '', src: '/test.glb' },
})

test('rotation controls are discovered in collapsed section children in either language', () => {
  for (const label of [
    'Rotation',
    'Yaw',
    '旋转',
    '偏航',
    <>
      Y<sub>rot</sub>
    </>,
  ]) {
    expect(
      hasInspectorRotation(
        <div>
          <Control unit="°" label={label} />
        </div>,
      ),
    ).toBe(true)
  }
  expect(hasInspectorRotation(<Control rotationControl />)).toBe(true)
})

test('non-rotation angular controls and absent conditional controls do not expose rotation', () => {
  expect(hasInspectorRotation(<Control unit="°" label="Opening angle" />)).toBe(false)
  expect(hasInspectorRotation(<>{false && <Control unit="°" label="Rotation" />}</>)).toBe(false)
  expect(isRotationLabel('Position')).toBe(false)
})

test('registry fields honor visibility and support scalar and vector rotations', () => {
  expect(hasInspectorRotation(<Control field={{ key: 'rotation', kind: 'vec3' }} />, node)).toBe(
    true,
  )
  expect(
    hasInspectorRotation(
      <Control field={{ key: 'rotation', kind: 'number', visibleIf: () => false }} />,
      node,
    ),
  ).toBe(false)
  expect(hasInspectorRotation(<Control field={{ key: 'position', kind: 'vec3' }} />, node)).toBe(
    false,
  )
})
