const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const [workspace, requirements, destination] = process.argv.slice(2)
if (!workspace || !requirements || !destination) {
  throw new Error('Arguments: workspace requirements-directory output-directory')
}
const lock = JSON.parse(
  fs.readFileSync(path.join(requirements, 'manifests/source-lock.json'), 'utf8'),
)
const roots = {
  Pascal: { root: path.join(workspace, 'editor-integration'), key: 'pascal' },
  Aedifex: { root: path.join(workspace, '_sources/aedifex'), key: 'aedifex' },
  openPlan3D: { root: path.join(workspace, '_sources/openplan3d'), key: 'openplan' },
}
function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
}
for (const source of Object.values(roots)) {
  source.commit = lock.projects[source.key].commit
  source.files = new Set(
    git(source.root, 'ls-tree', '-r', '--name-only', source.commit).trim().split('\n'),
  )
}
function parseCSV(text) {
  const rows = []
  let row = [],
    value = '',
    quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"'
        i++
      } else quoted = !quoted
    } else if (!quoted && (ch === ',' || ch === '\n')) {
      row.push(value.replace(/\r$/, ''))
      value = ''
      if (ch === '\n') {
        rows.push(row)
        row = []
      }
    } else value += ch
  }
  if (quoted) throw new Error('Unclosed CSV quote')
  if (value || row.length) {
    row.push(value)
    rows.push(row)
  }
  const [header, ...data] = rows
  return data
    .filter((row) => row.some(Boolean))
    .map((row) => {
      if (row.length !== header.length) throw new Error('CSV column count mismatch')
      return Object.fromEntries(header.map((key, i) => [key.replace(/^\uFEFF/, ''), row[i]]))
    })
}
const planned = parseCSV(
  fs.readFileSync(path.join(requirements, 'manifests/file-transfer-map.csv'), 'utf8'),
)
function expand(source, entry) {
  if (source.files.has(entry)) return [entry]
  if (entry.endsWith('/')) return [...source.files].filter((file) => file.startsWith(entry)).sort()
  if (entry.startsWith('docs/local-custom-models.md')) {
    return [...source.files]
      .filter(
        (file) =>
          file === 'docs/local-custom-models.md' ||
          /^src\/lib\/(?:utils\/(?:localGLB[^/]*|customModelDefinitions|rasterHeader)|services\/customModel[^/]*)\.ts$/.test(
            file,
          ),
      )
      .sort()
  }
  if (entry.startsWith('docs/project-package-v1.md')) {
    return [
      'docs/project-package-v1.md',
      'src/lib/services/projectPackage.ts',
      'src/lib/utils/projectPackageZip.ts',
      'src/lib/utils/projectPackageBridge.ts',
    ]
  }
  if (entry.startsWith('docs/furniture-inventory.md')) return ['docs/furniture-inventory.md']
  throw new Error(`Unresolved discovery entry: ${entry}`)
}
function targetFor(plan, file) {
  const target = plan.proposed_target
  if (target === '无') return ''
  if (target === '原位保留') return file
  if (target.includes('integrations/camera/'))
    return 'packages/editor/src/integrations/camera/ + packages/editor/src/integrations/ai-image/'
  if (target.startsWith('integrations/')) {
    const cleaned = target.replace(/（[^）]*）/g, '')
    const suffix = cleaned.endsWith('/')
      ? plan.source_path_or_discovery_entry.endsWith('/')
        ? file.slice(plan.source_path_or_discovery_entry.length)
        : path.posix.basename(file)
      : ''
    return `packages/editor/src/${cleaned}${suffix}`
  }
  if (
    target.startsWith('apps/') &&
    target.endsWith('/') &&
    plan.source_path_or_discovery_entry.endsWith('/')
  ) {
    return target + file.slice(plan.source_path_or_discovery_entry.length)
  }
  if (target.startsWith('server/')) return 'apps/editor/lib/integration-ai/image/'
  if (target === '整合capture回归测试') return 'tests/integration/capture/'
  if (target === '必要素材目录与notices')
    return 'apps/editor/public/integration-assets/ + docs/integration/asset-provenance.json'
  return target
}
function testFor(plan) {
  const groups = {
    T03: 'source identity/import audit',
    T04: 'browser bundle/store identity',
    T05: 'atomic commit/undo/revision/coordinates',
    T06: 'GLB admission/hash/catalog/asset lifetime',
    T07: 'snapshot/sidecar/save failure/reopen',
    T08: 'ZIP corruption/path/CRC/roundtrip',
    T09: 'four outlines/six templates/one undo',
    T10: 'pose/capture layers/PNG pixels',
    T11: 'SSE fragments/cancel/limits/provider boundary',
    T12: '36 tools/schema/validation/unsupported tools',
    T13: 'human confirmation/stale preview/cancel',
    T14: 'image request/cancel/result provenance',
    T16: 'six original plugins/manual behavior',
    T02: 'original baseline',
  }
  return plan.tasks
    .split(';')
    .map((task) => groups[task] ?? task)
    .join('; ')
}
function analyze(source, file, raw) {
  if (!/\.(?:[cm]?[jt]sx?|svelte)$/.test(file)) return { imports: [], signals: [] }
  const script = file.endsWith('.svelte')
    ? [...raw.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => ({
        text: match[1],
        offset: match.index + match[0].indexOf('>') + 1,
      }))
    : [{ text: raw, offset: 0 }]
  const imports = [],
    signals = []
  function resolveLocal(specifier) {
    const base = specifier.startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
      : specifier.startsWith('$lib/')
        ? `src/lib/${specifier.slice(5)}`
        : null
    if (!base) return null
    return (
      [
        base,
        ...['.ts', '.tsx', '.js', '.json', '.svelte', '/index.ts', '/index.tsx', '/index.js'].map(
          (suffix) => base + suffix,
        ),
      ].find((candidate) => source.files.has(candidate)) ?? null
    )
  }
  for (const { text, offset } of script) {
    const ast = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const line = (node) => raw.slice(0, offset + node.getStart(ast)).split('\n').length
    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const specifier = node.moduleSpecifier.text
        const clause = ts.isImportDeclaration(node) ? node.importClause : node
        const typeOnly = Boolean(clause?.isTypeOnly)
        imports.push({
          specifier,
          typeOnly,
          kind: ts.isImportDeclaration(node) ? 'import' : 'export',
          line: line(node),
          resolvedLocal: resolveLocal(specifier),
        })
      }
      if (ts.isCallExpression(node)) {
        const expression = node.expression.getText(ast)
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword || expression === 'require') {
          const argument = node.arguments[0]
          const specifier = argument && ts.isStringLiteral(argument) ? argument.text : null
          imports.push({
            specifier,
            typeOnly: false,
            kind: expression,
            line: line(node),
            resolvedLocal: specifier ? resolveLocal(specifier) : null,
          })
        }
        if (
          /(?:^|\.)(?:createNode|createNodes|updateNode|updateNodes|deleteNode|deleteNodes|setScene|setState|applyPatch|fetch|captureScreenshot|confirmGhostPreview|pause|resume|setItem|removeItem)$/.test(
            expression,
          )
        ) {
          signals.push({ expression, line: line(node) })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  return { imports, signals }
}
const cache = new Map()
function inspect(project, file) {
  const key = `${project}:${file}`
  if (cache.has(key)) return cache.get(key)
  const source = roots[project]
  if (!source.files.has(file)) throw new Error(`Source missing: ${key}`)
  const bytes = execFileSync('git', ['-C', source.root, 'show', `${source.commit}:${file}`], {
    maxBuffer: 32 * 1024 * 1024,
  })
  const raw = bytes.toString('utf8')
  const item = {
    project,
    sourceCommit: source.commit,
    path: file,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    ...analyze(source, file, raw),
  }
  cache.set(key, item)
  return item
}
const rows = []
for (const plan of planned) {
  const project = plan.source_project
  const files = expand(roots[project], plan.source_path_or_discovery_entry)
  if (!files.length) throw new Error(`Empty discovery: ${plan.source_path_or_discovery_entry}`)
  for (const file of files) {
    const item = inspect(project, file)
    rows.push({
      source_project: project,
      source_commit: item.sourceCommit,
      source_path: file,
      source_sha256: item.sha256,
      proposed_target: targetFor(plan, file),
      action: plan.action,
      tasks: plan.tasks,
      dependencies: item.imports
        .map((value) => `${value.typeOnly ? 'type:' : ''}${value.specifier ?? '<computed>'}`)
        .join(';'),
      required_adaptation: plan.required_adaptation,
      required_tests: testFor(plan),
      implementation_status: 'NOT_PORTED_REFERENCE_ONLY',
    })
  }
}
// Follow local imports for audit only; reachability does not authorize copying a dependency.
for (const item of cache.values()) {
  for (const dependency of item.imports)
    if (dependency.resolvedLocal) inspect(item.project, dependency.resolvedLocal)
}
fs.mkdirSync(destination, { recursive: true })
const columns = Object.keys(rows[0])
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`
fs.writeFileSync(
  path.join(destination, 'file-transfer-map.csv'),
  `${[columns, ...rows.map((row) => columns.map((key) => row[key]))]
    .map((row) => row.map(quote).join(','))
    .join('\n')}\n`,
)
const graph = {
  method: 'TypeScript AST; pinned git blobs; local-import closure; no donor evaluation',
  limitations:
    'Named type-only specifiers within mixed imports are conservatively runtime. Package aliases are recorded, not resolved. Signals are syntactic call sites, not a complete call graph. Svelte analysis covers script blocks only.',
  files: [...cache.values()].sort((a, b) =>
    `${a.project}:${a.path}`.localeCompare(`${b.project}:${b.path}`),
  ),
}
fs.writeFileSync(
  path.join(destination, 'source-dependencies.json'),
  `${JSON.stringify(graph, null, 2)}\n`,
)
console.log(
  JSON.stringify({
    mappedFiles: rows.length,
    dependencyFiles: cache.size,
    computedImports: graph.files.reduce(
      (sum, file) => sum + file.imports.filter((value) => value.specifier === null).length,
      0,
    ),
  }),
)
