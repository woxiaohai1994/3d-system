import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getModelAssetStore } from '../apps/editor/lib/model-assets/store'
import { initialTaxonomy, validateTaxonomy } from '../apps/editor/lib/model-assets/taxonomy'

const store = getModelAssetStore()
const previous = store.taxonomy()
const seeds = new Map(initialTaxonomy.nodes.map((n) => [n.id, n]))
const nodes = [
  ...initialTaxonomy.nodes.map((seed) => {
    const existing = previous.nodes.find((n) => n.id === seed.id)
    return existing
      ? { ...existing, name: seed.name, parentId: seed.parentId, icon: seed.icon }
      : seed
  }),
  ...previous.nodes.filter((n) => !seeds.has(n.id)),
]
validateTaxonomy(nodes)
if (process.argv.includes('--apply')) {
  const backup = path.join(store.directory, 'backups', `residential-${Date.now()}.json`)
  mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 })
  writeFileSync(backup, JSON.stringify({ taxonomy: previous, records: store.list() }, null, 2), {
    mode: 0o600,
  })
  const taxonomy = store.saveTaxonomy(previous.revision, nodes)
  console.log(
    JSON.stringify({
      backup,
      revision: taxonomy.revision,
      roots: nodes.filter((n) => !n.parentId).map((n) => n.name),
    }),
  )
} else {
  console.log(JSON.stringify({ revision: previous.revision, proposed: nodes }, null, 2))
}
