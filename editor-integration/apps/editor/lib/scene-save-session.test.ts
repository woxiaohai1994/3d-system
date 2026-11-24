import { expect, test } from 'bun:test'
import { SceneSaveSession } from './scene-save-session'

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('a server echo before its PUT response acknowledges the save without loading the scene', async () => {
  const session = new SceneSaveSession(12),
    response = deferred<number>(),
    versions: number[] = [],
    save = session.save('camera-lens-5', async (version) => {
      versions.push(version)
      const next = await response.promise
      session.acknowledge(next)
    })
  await Promise.resolve()
  expect(versions).toEqual([12])
  expect(session.observe(13, 'camera-lens-5')).toBe('own')
  response.resolve(13)
  await save
  expect(session.observe(13, 'camera-lens-5')).toBe('old')
  await session.save('camera-lens-24-undo', async (version) => {
    versions.push(version)
    session.acknowledge(14)
  })
  expect(versions).toEqual([12, 13])
})

test('an undo saved after the pending write uses its acknowledged If-Match version', async () => {
  const session = new SceneSaveSession(7),
    response = deferred<void>(),
    started: { value: string; version: number }[] = [],
    first = session.save('moved-camera', async (version) => {
      started.push({ value: 'moved', version })
      await response.promise
      session.acknowledge(8)
    })
  expect(started).toEqual([{ value: 'moved', version: 7 }])
  expect(session.observe(8, 'moved-camera')).toBe('own')
  response.resolve()
  await first
  await session.save('restored-camera', async (version) => {
    started.push({ value: 'restored', version })
    session.acknowledge(9)
  })
  expect(started).toEqual([
    { value: 'moved', version: 7 },
    { value: 'restored', version: 8 },
  ])
  expect(session.observe(9, 'restored-camera')).toBe('old')
})

test('an older PUT response cannot roll back a newer remote event version', async () => {
  const session = new SceneSaveSession(1),
    response = deferred<void>(),
    save = session.save('own-camera', async () => {
      await response.promise
      session.acknowledge(2)
    })
  await Promise.resolve()
  expect(session.observe(3, 'remote-camera')).toBe('remote')
  response.resolve()
  await save
  expect(session.observe(3, 'own-camera')).toBe('old')
  await session.save('next-camera', async (version) => expect(version).toBe(3))
})

test('failed requests release ownership and do not prevent later saves', async () => {
  const session = new SceneSaveSession(4)
  await expect(
    session.save('failed-camera', async () => {
      throw new Error('offline')
    }),
  ).rejects.toThrow('offline')
  expect(session.observe(5, 'failed-camera')).toBe('remote')
  await session.save('retry-camera', async (version) => {
    expect(version).toBe(5)
    expect(session.observe(6, 'retry-camera')).toBe('own')
    session.acknowledge(6)
  })
})

test('an unload flush starts immediately while a normal save is still pending', async () => {
  const session = new SceneSaveSession(10),
    response = deferred<void>(),
    started: string[] = [],
    normal = session.save('normal-camera', async () => {
      started.push('normal')
      await response.promise
    }),
    flush = session.save('latest-camera', async () => {
      started.push('keepalive')
      expect(session.observe(11, 'latest-camera')).toBe('own')
    })
  expect(started).toEqual(['normal', 'keepalive'])
  await flush
  response.resolve()
  await normal
})

test('equal concurrent signatures retain ownership until every request settles', async () => {
  const session = new SceneSaveSession(10),
    firstResponse = deferred<void>(),
    secondResponse = deferred<void>(),
    first = session.save('same-camera', async () => {
      await firstResponse.promise
      session.acknowledge(11)
    }),
    second = session.save('same-camera', async (version) => {
      expect(version).toBe(10)
      await secondResponse.promise
      session.acknowledge(12)
    })
  firstResponse.resolve()
  await first
  expect(session.observe(12, 'same-camera')).toBe('own')
  secondResponse.resolve()
  await second
  expect(session.observe(13, 'same-camera')).toBe('remote')
})
