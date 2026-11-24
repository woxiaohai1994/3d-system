import { expect, test } from 'bun:test'
import { cameraPreviewErrorText } from './camera-preview-error'
import { motionStatusText } from './motion-status-text'

test('Chinese preview failures keep raw renderer diagnostics out of user messages', () => {
  for (const diagnostic of [
    'THREE.WebGLProgram: Shader compilation failed',
    'Animated assets did not finish loading',
    'Unable to allocate GPU texture',
  ]) {
    expect(cameraPreviewErrorText(diagnostic, true)).not.toMatch(/[A-Za-z]{2}/)
    expect(cameraPreviewErrorText(diagnostic, true)).toContain('重试')
    expect(cameraPreviewErrorText(diagnostic, false)).toContain(diagnostic)
  }
})

test('preset validation statuses explain the required action in Chinese', () => {
  expect(motionStatusText('preset-last', true)).toContain('最后一个关键帧')
  expect(motionStatusText('choose-target', true)).toContain('环绕目标')
  expect(motionStatusText('invalid-time', true)).toContain('至少间隔一帧')
  expect(motionStatusText('preset-last', false)).toContain('last keyframe')
})

test('unknown runtime states use a Chinese fallback while existing Chinese messages remain readable', () => {
  const diagnostic = 'Invalid input: expected number, received undefined'
  expect(motionStatusText(diagnostic, true)).not.toMatch(/[A-Za-z]{2}/)
  expect(motionStatusText(diagnostic, true)).toContain('重试')
  expect(motionStatusText(diagnostic, false)).toBe(diagnostic)
  const chinese = '每个相机工作区最多一台相机，请先新建工作区'
  expect(motionStatusText(chinese, true)).toBe(chinese)
  expect(motionStatusText('浏览器不支持 MP4 编码', true)).toBe('浏览器不支持 MP4 编码')
})
