import { expect, test } from 'bun:test'
import { ASSETS_CDN_URL, resolveAssetUrl, resolveCdnUrl } from './asset-url'

test('host model files and thumbnails stay on the host; bundled assets retain CDN resolution', async () => {
  for (const path of [
    '/api/model-assets/model_123/file',
    '/api/model-assets/model_123/thumbnail',
  ]) {
    expect(resolveCdnUrl(path)).toBe(path)
    expect(await resolveAssetUrl(path)).toBe(path)
  }
  expect(resolveCdnUrl('/models/builtin.glb')).toBe(`${ASSETS_CDN_URL}/models/builtin.glb`)
  expect(await resolveAssetUrl('models/builtin.glb')).toBe(`${ASSETS_CDN_URL}/models/builtin.glb`)
  expect(resolveCdnUrl('https://example.com/file.glb')).toBe('https://example.com/file.glb')
})
