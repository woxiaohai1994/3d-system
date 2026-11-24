import { afterEach, expect, test } from 'bun:test'
import { sampleScenePlayback } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { create } from '@react-three/test-renderer'
import type { DirectionalLight, InstancedMesh } from 'three'
import AtmosphereLayer from '../node_modules/@pascal-app/plugin-environment/src/atmosphere/layer'
import { sampleLightning } from '../node_modules/@pascal-app/plugin-environment/src/atmosphere/weather'
import { useEnvironmentStore } from '../node_modules/@pascal-app/plugin-environment/src/store'
import { DistantBirds } from '../node_modules/@pascal-app/plugin-environment/src/surroundings/distant-birds'
import { LighthouseBeacon } from '../node_modules/@pascal-app/plugin-environment/src/surroundings/lighthouse-beacon'
import { setSurroundingsNightFactor } from '../node_modules/@pascal-app/plugin-environment/src/surroundings/night-lighting'
import { Lights } from '../packages/viewer/src/components/viewer/lights'
import { SceneAtmosphere } from '../packages/viewer/src/components/viewer/scene-atmosphere'

afterEach(() => sampleScenePlayback(null))

test('mounted birds hold a sampled pose through arbitrary render delays and restore ordinary flight', async () => {
  const renderer = await create(<DistantBirds boundary={[[-10, -10], [10, -10], [10, 10], [-10, 10]]} heightAt={() => 0} seed="motion-clock" moving />)
  try {
    const mesh = renderer.scene.find(node => node.instance.name === 'environment-distant-bird-instances').instance as InstancedMesh
    await renderer.advanceFrames(2, 0.1)
    const ordinary = Array.from(mesh.instanceMatrix.array)
    sampleScenePlayback(8)
    const atEight = Array.from(mesh.instanceMatrix.array)
    const wings = Array.from(mesh.morphTexture!.source.data.data)
    expect(atEight).not.toEqual(ordinary)
    await renderer.advanceFrames(10, 2)
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(atEight)
    sampleScenePlayback(0.25)
    expect(Array.from(mesh.instanceMatrix.array)).not.toEqual(atEight)
    sampleScenePlayback(8)
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(atEight)
    expect(Array.from(mesh.morphTexture!.source.data.data)).toEqual(wings)
    sampleScenePlayback(null)
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(ordinary)
    await renderer.advanceFrames(1, 0.1)
    expect(Array.from(mesh.instanceMatrix.array)).not.toEqual(ordinary)
  } finally { await renderer.unmount() }
})

test('lighthouse seeks without accumulated render time and restores its previous angle', async () => {
  const paused = useViewer.getState().renderPaused
  useViewer.setState({ renderPaused: false })
  setSurroundingsNightFactor(1)
  const renderer = await create(<LighthouseBeacon plan={{ position: [0, 0, 0], rotationY: 0.4, height: 15, stripe: '#fff', foundationDepth: 1 }} />)
  try {
    const root = renderer.scene.find(node => node.instance.name === 'environment-lighthouse-beacon').instance
    await renderer.advanceFrames(2, 0.1)
    const ordinary = root.rotation.y
    sampleScenePlayback(5)
    expect(root.rotation.y).toBeCloseTo(0.4 + Math.PI / 2)
    await renderer.advanceFrames(5, 10)
    expect(root.rotation.y).toBeCloseTo(0.4 + Math.PI / 2)
    sampleScenePlayback(1)
    expect(root.rotation.y).toBeCloseTo(0.4 + Math.PI / 10)
    sampleScenePlayback(null)
    expect(root.rotation.y).toBeCloseTo(ordinary)
  } finally { await renderer.unmount(); useViewer.setState({ renderPaused: paused }) }
})

test('storm flashes have repeatable timing and shape seeds across reverse seeks', () => {
  expect(sampleLightning(0).flash).toBe(0)
  expect(sampleLightning(0.2).flash).toBeGreaterThan(0.5)
  expect(sampleLightning(1).flash).toBe(0)
  const frames = [0.2, 0.4, 30, 60, 300, 599].map(sampleLightning)
  for (let index = frames.length - 1; index >= 0; index--)
    expect(sampleLightning([0.2, 0.4, 30, 60, 300, 599][index]!)).toEqual(frames[index])
  expect(sampleLightning(599).index).toBeGreaterThan(15)
})

test('sky clock updates actual directional lights before rendering and leaves stored time untouched', async () => {
  const previous = useEnvironmentStore.getState()
  useEnvironmentStore.setState({ skyEnabled: true, skyPlaying: true, skyMotion: true, skySettings: { ...previous.skySettings, timeOfDay: 12 }, weatherSettings: { ...previous.weatherSettings, rain: 0, snow: 0, storm: false } })
  const renderer = await create(<><Lights /><AtmosphereLayer atmosphereComponent={SceneAtmosphere} /></>)
  try {
    const snapshot = () => renderer.scene.findAll(node => node.instance.type === 'DirectionalLight').map(node => {
      const light = node.instance as DirectionalLight
      return [light.intensity, ...light.position.toArray(), ...light.color.toArray()]
    })
    sampleScenePlayback(0)
    const noon = snapshot()
    sampleScenePlayback(40)
    const evening = snapshot()
    expect(evening).not.toEqual(noon)
    await renderer.advanceFrames(20, 1)
    expect(snapshot()).toEqual(evening)
    sampleScenePlayback(0)
    expect(snapshot()).toEqual(noon)
    expect(useEnvironmentStore.getState().skySettings.timeOfDay).toBe(12)
    sampleScenePlayback(null)
    expect(snapshot()).toEqual(noon)
  } finally { await renderer.unmount(); useEnvironmentStore.setState(previous) }
})

test('registered pond fish seek on the shared clock and restore their ordinary pose', async () => {
  const { sceneRegistry } = await import('@pascal-app/core')
  const { default: PondSystem } = await import('../node_modules/@pascal-app/plugin-environment/src/pond/system')
  const { buildPondPropGeometry } = await import('../node_modules/@pascal-app/plugin-environment/src/pond/props')
  const { POND_KIND } = await import('../node_modules/@pascal-app/plugin-environment/src/pond/schema')
  const root = buildPondPropGeometry([{ id: 'motion-fish', kind: 'koi', position: [5, 5], yaw: 0, scale: 1 }], {
    level: 1, area: 100,
    positions: new Float32Array([0, 1, 0, 10, 1, 0, 10, 1, 10, 0, 1, 0, 10, 1, 10, 0, 1, 10]),
    depths: new Float32Array([2, 2, 2, 2, 2, 2]),
  })
  const id = 'pond_motion_clock'
  sceneRegistry.nodes.set(id, root)
  sceneRegistry.byType[POND_KIND]!.add(id)
  const sceneApi = { nodes: () => ({ [id]: { id, type: POND_KIND, visible: true } }), markDirty: () => {} } as unknown as import('@pascal-app/core').SceneApi
  const renderer = await create(<PondSystem sceneApi={sceneApi} />)
  const matrices = () => {
    const result: number[] = []
    root.traverse(object => { if ((object as InstancedMesh).isInstancedMesh) result.push(...(object as InstancedMesh).instanceMatrix.array) })
    return result
  }
  try {
    await renderer.advanceFrames(2, 0.1)
    const ordinary = matrices()
    sampleScenePlayback(8)
    const atEight = matrices()
    expect(atEight.length).toBeGreaterThan(0)
    expect(atEight).not.toEqual(ordinary)
    await renderer.advanceFrames(10, 3)
    expect(matrices()).toEqual(atEight)
    sampleScenePlayback(0.5)
    expect(matrices()).not.toEqual(atEight)
    sampleScenePlayback(8)
    expect(matrices()).toEqual(atEight)
    sampleScenePlayback(null)
    expect(matrices()).toEqual(ordinary)
  } finally {
    await renderer.unmount()
    sceneRegistry.nodes.delete(id)
    sceneRegistry.byType[POND_KIND]!.delete(id)
    root.traverse(object => {
      const mesh = object as InstancedMesh
      if (!mesh.isInstancedMesh) return
      mesh.dispose(); mesh.geometry.dispose()
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose()
    })
  }
})

test('weather ignores hidden-tab throttling during sampling and lightning follows each render camera', async () => {
  const { spyOn } = await import('bun:test')
  const preferences = await import('../node_modules/@pascal-app/plugin-environment/src/atmosphere/weather-preferences')
  const { WeatherLayer } = await import('../node_modules/@pascal-app/plugin-environment/src/atmosphere/weather')
  const { PerspectiveCamera } = await import('three/webgpu')
  const hidden = spyOn(preferences, 'usePageVisible').mockReturnValue(false)
  const reduced = spyOn(preferences, 'useReducedMotionPreference').mockReturnValue(false)
  const renderer = await create(<WeatherLayer settings={{ rain: 0.7, snow: 0, wind: 0.3, storm: true, thunderAudio: false }} />)
  try {
    const weather = renderer.scene.find(node => node.instance.name === 'environment-weather').instance
    const rain = weather.getObjectByName('environment-camera-rain')!
    const bolt = weather.getObjectByName('environment-lightning-ribbon')! as import('three/webgpu').Mesh
    expect(weather.visible).toBe(false)
    sampleScenePlayback(0.2)
    expect(weather.visible).toBe(true)
    expect(rain.visible).toBe(true)
    expect(bolt.visible).toBe(true)
    const fakeRenderer = { getRenderTarget: () => ({ width: 720, height: 1280 }), getSize: (target: { set(x: number, y: number): void }) => target.set(100, 100) } as unknown as import('three/webgpu').WebGLRenderer
    const camera = new PerspectiveCamera(50, 9 / 16)
    camera.position.set(3, 2, 4)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const renderBolt = () => bolt.onBeforeRender(fakeRenderer, renderer.scene.instance as import('three/webgpu').Scene, camera, bolt.geometry, bolt.material as import('three/webgpu').Material, null!)
    renderBolt()
    const first = bolt.position.clone()
    const shape = [...bolt.geometry.getAttribute('position').array]
    camera.position.x += 10
    camera.updateMatrixWorld(true)
    renderBolt()
    expect(bolt.position.x - first.x).toBeCloseTo(10)
    expect([...bolt.geometry.getAttribute('position').array]).toEqual(shape)
    await renderer.advanceFrames(10, 1)
    expect(bolt.visible).toBe(true)
    sampleScenePlayback(2)
    expect(bolt.visible).toBe(false)
    sampleScenePlayback(0.2)
    expect(bolt.visible).toBe(true)
    sampleScenePlayback(null)
    expect(weather.visible).toBe(false)
    expect(rain.visible).toBe(false)
  } finally { await renderer.unmount(); hidden.mockRestore(); reduced.mockRestore() }
})
