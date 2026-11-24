import { Input, BufferSource, ALL_FORMATS, EncodedPacketSink } from 'mediabunny'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

for (const path of process.argv.slice(2)) {
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(await readFile(path)) })
  try {
    const track = await input.getPrimaryVideoTrack()
    assert.ok(track)
    const times = []
    for await (const packet of new EncodedPacketSink(track).packets()) times.push(packet.timestamp)
    const duration = await input.computeDuration()
    const fps = Math.round(times.length / duration)
    const result = { path, codec: await track.getCodec(), width: await track.getDisplayWidth(), height: await track.getDisplayHeight(), duration, frames: times.length, fps }
    assert.equal(result.codec, 'avc')
    assert.ok([24, 30].includes(fps))
    assert.ok(Math.abs(times.length - duration * fps) < 1e-3)
    times.forEach((time, i) => assert.ok(Math.abs(time - i / fps) < 1e-5))
    console.log(JSON.stringify(result))
  } finally { input.dispose() }
}
