import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { builtinRecords } from './builtins'
import { type ModelMetadata, type ModelRecord, modelMetadataSchema, recordAsset } from './contracts'
import { inspectModel } from './inspect'
import {
  initialTaxonomy,
  type ModelCategory,
  type ModelTaxonomy,
  validateTaxonomy,
} from './taxonomy'

export class ModelAssetStore {
  constructor(
    readonly directory: string,
    readonly builtins: ModelRecord[] = [],
  ) {}
  taxonomy(): ModelTaxonomy {
    const file = path.join(this.directory, 'taxonomy.json')
    return existsSync(file)
      ? JSON.parse(readFileSync(file, 'utf8'))
      : structuredClone(initialTaxonomy)
  }
  saveTaxonomy(revision: number, nodes: ModelCategory[]) {
    const current = this.taxonomy()
    if (current.revision !== revision) throw new Error('分类已更新，请刷新后重试。')
    validateTaxonomy(nodes)
    const ids = new Set(nodes.map((n) => n.id))
    if (this.list().some((r) => !ids.has(r.metadata.category)))
      throw new Error('请先移走该分类中的模型（包括待入库和回收站中的模型）。')
    const next = { revision: revision + 1, nodes }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const temp = path.join(this.directory, `taxonomy-${randomUUID()}.tmp`)
    writeFileSync(temp, JSON.stringify(next), { mode: 0o600 })
    renameSync(temp, path.join(this.directory, 'taxonomy.json'))
    return next
  }
  private folder(id: string) {
    if (this.builtins.some((record) => record.id === id) && /^[a-zA-Z0-9_-]+$/.test(id))
      return path.join(this.directory, `builtin-${id}`)
    if (!/^model_[a-f0-9]{32}$/.test(id)) throw new Error('模型编号无效。')
    return path.join(this.directory, id)
  }
  get(id: string): ModelRecord {
    const file = path.join(this.folder(id), 'record.json')
    if (!existsSync(file)) {
      const builtin = this.builtins.find((record) => record.id === id)
      if (builtin) return structuredClone(builtin)
      throw new Error('未找到模型。')
    }
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  list() {
    const ids = new Set(this.builtins.map((record) => record.id))
    if (existsSync(this.directory))
      for (const id of readdirSync(this.directory)) if (/^model_[a-f0-9]{32}$/.test(id)) ids.add(id)
    return [...ids]
      .flatMap((id) => {
        try {
          return [this.get(id)]
        } catch {
          return []
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  file(id: string, kind: 'file' | 'thumbnail') {
    const folder = this.folder(id)
    this.get(id)
    return readFileSync(path.join(folder, kind === 'file' ? 'original.glb' : 'thumbnail.png'))
  }
  private write(record: ModelRecord) {
    const folder = this.folder(record.id)
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    const temp = path.join(folder, `${randomUUID()}.tmp`)
    writeFileSync(temp, JSON.stringify(record), { mode: 0o600 })
    renameSync(temp, path.join(folder, 'record.json'))
  }
  async import(bytes: Buffer, filename: string) {
    const hash = createHash('sha256').update(bytes).digest('hex')
    const id = `model_${hash.slice(0, 32)}`
    if (existsSync(path.join(this.folder(id), 'record.json')))
      return { record: this.get(id), duplicate: true }
    const facts = await inspectModel(bytes)
    const metadata = modelMetadataSchema.parse({
      name: filename.replace(/\.glb$/i, '').slice(0, 120) || '新模型',
      category:
        this.taxonomy().nodes.find((n) => n.id === 'furniture')?.id ?? this.taxonomy().nodes[0]!.id,
    })
    const record: ModelRecord = {
      id,
      hash,
      filename: filename.slice(0, 255),
      bytes: bytes.length,
      origin: 'imported',
      revision: 0,
      status: 'draft',
      createdAt: new Date().toISOString(),
      facts,
      metadata,
      asset: recordAsset({ id, metadata, facts }),
    }
    // Another request may have finished inspecting the same content while this one awaited parsing.
    if (existsSync(path.join(this.folder(id), 'record.json')))
      return { record: this.get(id), duplicate: true }
    mkdirSync(this.folder(id), { recursive: true, mode: 0o700 })
    writeFileSync(path.join(this.folder(id), 'original.glb'), bytes, { mode: 0o600 })
    this.write(record)
    return { record, duplicate: false }
  }
  publish(id: string, revision: number, input: ModelMetadata, thumbnail: Buffer) {
    const record = this.get(id)
    if (record.status === 'deleted') throw new Error('请先从回收站恢复模型。')
    if (record.revision !== revision) throw new Error('模型资料已更新，请刷新后重试。')
    if (
      thumbnail.length < 8 ||
      thumbnail.length > 2_000_000 ||
      thumbnail.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    )
      throw new Error('请等待模型预览加载完成后再入库。')
    const metadata = modelMetadataSchema.parse(input)
    if (!this.taxonomy().nodes.some((n) => n.id === metadata.category))
      throw new Error('分类不存在，请刷新后重新选择。')
    const asset = recordAsset({ ...record, metadata })
    if (asset.dimensions!.some((value) => value < 0.001 || value > 100))
      throw new Error('校正后的尺寸超出范围，请检查单位。')
    mkdirSync(this.folder(id), { recursive: true, mode: 0o700 })
    writeFileSync(path.join(this.folder(id), 'thumbnail.png'), thumbnail, { mode: 0o600 })
    const next: ModelRecord = {
      ...record,
      metadata,
      asset,
      status: 'published',
      revision: revision + 1,
    }
    this.write(next)
    return next
  }
  setCollection(id: string, revision: number, collection: string, enabled: boolean) {
    const record = this.get(id)
    if (record.revision !== revision) throw new Error('模型资料已更新，请刷新后重试。')
    if (record.status !== 'published') throw new Error('请先将模型确认入库。')
    const collections = new Set(record.collections ?? [])
    if (enabled) collections.add(collection)
    else collections.delete(collection)
    const next = { ...record, collections: [...collections], revision: revision + 1 }
    this.write(next)
    return next
  }
  setDeleted(id: string, revision: number, deleted: boolean) {
    const record = this.get(id)
    if (record.revision !== revision) throw new Error('模型资料已更新，请刷新后重试。')
    if (deleted === (record.status === 'deleted')) throw new Error('模型状态已变化，请刷新后重试。')
    const next: ModelRecord = {
      ...record,
      revision: revision + 1,
      status: deleted ? 'deleted' : (record.previousStatus ?? 'published'),
      previousStatus: deleted ? (record.status as 'draft' | 'published') : undefined,
    }
    this.write(next)
    return next
  }
  recordSuggestion(
    id: string,
    revision: number,
    suggestion: NonNullable<ModelRecord['suggestion']>,
  ) {
    const record = this.get(id)
    if (record.status === 'deleted') throw new Error('请先从回收站恢复模型。')
    if (record.revision !== revision) throw new Error('模型资料已变化，未应用旧的 AI 建议。')
    this.write({ ...record, suggestion })
  }
}

export function getModelAssetStore() {
  const directory =
    process.env.PASCAL_DATA_DIR ??
    (process.env.PASCAL_DB_PATH
      ? path.dirname(process.env.PASCAL_DB_PATH)
      : path.join(homedir(), '.pascal', 'data'))
  return new ModelAssetStore(path.join(directory, 'model-assets'), builtinRecords)
}
