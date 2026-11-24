export class SceneSaveSession {
  private currentVersion: number
  private pending = new Map<symbol, string>()

  constructor(version: number) {
    this.currentVersion = version
  }

  acknowledge(version: number) {
    this.currentVersion = Math.max(this.currentVersion, version)
  }

  observe(version: number, signature: string): 'old' | 'own' | 'remote' {
    if (version <= this.currentVersion) return 'old'
    this.acknowledge(version)
    return [...this.pending.values()].includes(signature) ? 'own' : 'remote'
  }

  async save<T>(signature: string, write: (version: number) => Promise<T>): Promise<T> {
    const ticket = Symbol('scene-save')
    this.pending.set(ticket, signature)
    // useAutoSave serializes normal saves. An unload keepalive must start now,
    // even while another request is pending, so never defer this callback.
    try {
      return await write(this.currentVersion)
    } finally {
      this.pending.delete(ticket)
    }
  }
}
