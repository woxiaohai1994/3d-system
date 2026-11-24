import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const ts = require('typescript')
const output = path.join(root, 'docs/integration/asset-audit')
fs.mkdirSync(output, { recursive: true })
const files = {
  catalog: 'packages/editor/src/components/ui/item-catalog/catalog-items.tsx',
  translations: 'packages/editor/src/i18n/catalog-messages.ts',
  categories: 'packages/editor/src/components/ui/action-menu/furnish-tools.tsx',
  placement: 'packages/editor/src/components/ai/furniture-placement-metadata.ts',
  resolver: 'packages/editor/src/components/ai/ai-catalog-resolver.ts',
  labels: 'packages/editor/src/components/ui/item-catalog/catalog-label.ts',
  mcp: 'packages/mcp/src/tools/asset-catalog.ts',
  tools: 'packages/editor/src/components/ai/prompt/openai-tools.ts',
  optimizer: 'packages/editor/src/components/ai/ai-layout-optimizer.ts',
  schema: 'packages/core/src/schema/nodes/item.ts',
  registry: 'packages/nodes/src/index.ts',
  prompt: 'packages/editor/src/components/ai/prompt/system-prompt.ts',
  uiCatalog: 'packages/editor/src/components/ui/item-catalog/item-catalog.tsx',
  confirmation: 'packages/editor/src/components/ai/preview/confirm-operations.ts',
  validation: 'packages/editor/src/components/ai/mutation/validate-item.ts',
  runtime: 'packages/editor/src/components/ai/runtime/default-catalog.ts',
}
const sources = {}
function read(rel) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8')
  sources[rel] = { sha256: crypto.createHash('sha256').update(text).digest('hex') }
  return text
}
function evaluate(rel, imports = {}) {
  const code = ts.transpileModule(read(rel), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: rel,
  }).outputText
  const exports = {}
  const sandbox = { exports, structuredClone, require: (name) => {
    if (!(name in imports)) throw new Error(`Unexpected import in audit: ${name}`)
    return imports[name]
  } }
  vm.runInNewContext(code, sandbox, { filename: rel, timeout: 3000 })
  return exports
}
function ast(rel) { return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }
function literals(rel, variable, objectEntries = false) {
  const tree = ast(rel)
  let expression
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(tree) === variable) expression = n.initializer
    ts.forEachChild(n, visit)
  }
  visit(tree)
  assert(expression, `Missing ${variable}`)
  if (objectEntries) return expression.properties.map(p => ({ key: p.name.text, line: tree.getLineAndCharacterOfPosition(p.getStart(tree)).line + 1 }))
  return expression.elements.map(n => {
    const id = n.properties.find(p => p.name?.getText(tree) === 'id')?.initializer?.text
    return { id, line: tree.getLineAndCharacterOfPosition(n.getStart(tree)).line + 1 }
  })
}
const { CATALOG_ITEMS: catalog } = evaluate(files.catalog)
const { catalogZhCN: zh } = evaluate(files.translations)
const { furnishTools: categoryConfig } = evaluate(files.categories)
const placement = evaluate(files.placement)
const { MCP_CATALOG_ITEMS: mcp } = evaluate(files.mcp)
const { OPENAI_TOOLS: toolDefs } = evaluate(files.tools)
const resolver = evaluate(files.resolver, {
  '@pascal-app/core': { useScene: { getState: () => ({ nodes: {} }) } },
  '../ui/item-catalog/catalog-items': { CATALOG_ITEMS: catalog },
})
const labels = evaluate(files.labels, {
  '../../../i18n/catalog-messages': { catalogZhCN: zh },
  './catalog-items': { CATALOG_ITEMS: catalog },
})
for (const key of ['optimizer','schema','prompt','uiCatalog','confirmation','validation','runtime']) read(files[key])
const catalogLines = new Map(literals(files.catalog, 'CATALOG_ITEMS').map(x => [x.id, x.line]))
const ruleLines = new Map(literals(files.placement, 'PLACEMENT_METADATA', true).map(x => [x.key, x.line]))
const categoryNames = { furniture: '家具', appliance: '电器', kitchen: '厨房', bathroom: '卫浴', outdoor: '户外' }
const keys = Object.keys(placement.PLACEMENT_METADATA)
const namedGroups = {}
for (const item of catalog) (namedGroups[item.name.toLowerCase()] ??= []).push(item.id)
const nameCollisions = Object.entries(namedGroups).filter(([, ids]) => ids.length > 1)
function resolution(query) {
  const r = resolver.resolveCatalogSlug(query)
  return { query, resolvedId: r.asset?.id ?? null, matchType: r.matchType, shapeWarning: r.shapeWarning ?? null, suggestions: r.suggestions?.map(a => a.id) ?? [] }
}
const rows = catalog.map((asset, index) => {
  const hits = keys.filter(k => asset.id.toLowerCase().includes(k) || asset.category.toLowerCase().includes(k))
  const meta = placement.getPlacementMeta(asset.id, asset.category)
  assert.equal(JSON.stringify(meta), JSON.stringify(hits.length ? placement.PLACEMENT_METADATA[hits[0]] : placement.getPlacementMeta('__no_matching_key__', '__none__')))
  const en = resolution(asset.name)
  const chineseName = labels.catalogDisplayName('zh-CN', asset)
  const cn = resolution(chineseName)
  assert.equal(resolution(asset.id).resolvedId, asset.id)
  const problems = []
  if (!hits.length) problems.push('使用通用摆放规则')
  if (hits.slice(1).some(k => JSON.stringify(placement.PLACEMENT_METADATA[k]) !== JSON.stringify(meta))) problems.push('后置规则被遮蔽且参数不同')
  if (en.resolvedId !== asset.id) problems.push('英文同名索引指向其他资产')
  if (!zh[asset.id]) problems.push('缺中文名称映射')
  if (asset.attachTo === 'ceiling') problems.push('AI 摘要错误附加必须有墙')
  const localDir = path.join(root, 'apps/editor/public/items', asset.id)
  const localFile = path.join(localDir, 'model.glb')
  let localHeader = null
  if (fs.existsSync(localFile)) {
    const fd = fs.openSync(localFile, 'r'); const b = Buffer.alloc(12); fs.readSync(fd,b,0,12,0); fs.closeSync(fd)
    localHeader = { magic: b.subarray(0,4).toString(), version: b.readUInt32LE(4), declaredBytes: b.readUInt32LE(8), actualBytes: fs.statSync(localFile).size }
  }
  const mcpEntry = mcp.find(a => a.id === asset.id)
  const diffFields = mcpEntry ? ['name','category','dimensions','offset','rotation','scale','attachTo','surface','interactive'].filter(k => JSON.stringify(asset[k] ?? null) !== JSON.stringify(mcpEntry[k] ?? null)) : []
  if (diffFields.length) problems.push('MCP 同 ID 元数据不同')
  return {
    index: index + 1, assetId: asset.id, nameEn: asset.name, nameZh: chineseName, category: asset.category,
    categoryZh: categoryNames[asset.category] ?? asset.category,
    asset, catalogSource: `${files.catalog}:${catalogLines.get(asset.id)}`,
    placementKey: hits[0] ?? 'DEFAULT', allPlacementMatches: hits, placement: meta,
    placementSource: `${files.placement}:${hits[0] ? ruleLines.get(hits[0]) : 325}`,
    exactIdResolved: true, englishNameResolvedId: en.resolvedId,
    chineseDirectMatch: cn, chineseUiSearchContainsSelf: labels.catalogMatchesSearch(asset, chineseName),
    localSameIdFile: fs.existsSync(localFile) ? path.relative(root,localFile) : null,
    localHeader, mcpDiffFields: diffFields, mcpAsset: mcpEntry ?? null, observations: problems,
  }
})
const ruleRows = keys.map((key, i) => ({
  order: i + 1, key, ...placement.PLACEMENT_METADATA[key],
  actualIds: rows.filter(r => r.placementKey === key).map(r => r.assetId),
  shadowedIds: rows.filter(r => r.allPlacementMatches.slice(1).includes(key)).map(r => r.assetId),
  shadowedBy: keys.slice(0,i).filter(k => key.includes(k)),
  source: `${files.placement}:${ruleLines.get(key)}`,
}))
const tags = {}
for (const r of rows) for (const tag of new Set(r.asset.tags ?? [])) (tags[tag] ??= []).push(r.assetId)
const ruleCaseQueries = ['bedside-table','floor-lamp','round-dining-table','办公桌','餐桌','sofa','unknown-model-zzzz','wall-light','ceiling-light']
const probes = ruleCaseQueries.map(resolution)
const categoryKeywordsTree = ast(files.resolver)
let categoryKeywords
function visitKeywords(n) {
  if (ts.isVariableDeclaration(n) && n.name.getText(categoryKeywordsTree) === 'categoryKeywords') {
    categoryKeywords = vm.runInNewContext('('+n.initializer.getText(categoryKeywordsTree)+')',{}, {timeout:1000})
  }
  ts.forEachChild(n,visitKeywords)
}
visitKeywords(categoryKeywordsTree)
const registryText = read(files.registry)
const registeredDefinitionNames = [...registryText.matchAll(/^    (\w+Definition) as unknown as AnyNodeDefinition/gm)].map(m=>m[1])
const nodeKinds = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const abs = path.join(dir,entry.name)
    if (entry.isDirectory()) walk(abs)
    else if (entry.name === 'definition.ts' || entry.name === 'definition.tsx') {
      const rel = path.relative(root,abs), s = read(rel)
      for (const m of s.matchAll(/export const (\w+Definition)[\s\S]*?=\s*\{/g)) {
        if (!registeredDefinitionNames.includes(m[1])) continue
        const body=s.slice(m.index+m[0].length)
        nodeKinds.push({definition:m[1], kind:body.match(/^  kind:\s*'([^']+)'/m)?.[1] ?? null, source:rel})
      }
    }
  }
}
walk(path.join(root,'packages/nodes/src'))
const issues = []
function issue(code,kind,ids,evidence,action) { issues.push({code,kind,assetIds:ids,evidence,action}) }
issue('A01','已复现',rows.filter(r=>r.englishNameResolvedId!==r.assetId).map(r=>r.assetId),'名称索引统一转小写后覆盖前项，按英文名称解析可能返回另一 ID。','执行必须用精确 ID，名称搜索返回候选集合。')
issue('A02','顺序敏感',rows.filter(r=>r.allPlacementMatches.slice(1).some(k=>JSON.stringify(placement.PLACEMENT_METADATA[k])!==JSON.stringify(r.placement))).map(r=>r.assetId),'5 项匹配多个参数不同的规则。bookshelf 优先于 shelf 合理；其余 4 项需检查更具体规则被遮蔽。','明确绑定功能/规则 ID，迁移前逐项核对当前行为。')
issue('A03','覆盖缺口',rows.filter(r=>r.placementKey==='DEFAULT').map(r=>r.assetId),'没有命中专用关键词，使用 floating/any 和通用净空。这不是加载失败。','按用途核对是否确实需要专用规则。')
issue('A04','已复现',rows.filter(r=>r.asset.attachTo==='ceiling').map(r=>r.assetId),'生成摘要将 ceiling 挂载同样写成 MUST have wall。','按挂载类型分别生成前置条件。')
issue('A05','设计限制',rows.filter(r=>r.chineseDirectMatch.resolvedId!==r.assetId).map(r=>r.assetId),'UI 可用中文搜索，但底层资产解析器不使用中文字典；真实对话依赖语言模型翻译/选 ID。','统一多语言目录检索；不把本探针当成真实 AI 中文失败率。')
issue('A06','数据差异',rows.filter(r=>r.mcpDiffFields.length).map(r=>r.assetId),'精简 MCP 目录与编辑器存在同 ID 元数据差异，不含 URL 地址差异。','共享目录前核对几何和历史场景，不任选一份覆盖。')
issue('A07','覆盖缺口',[],`建议分类表含 ${Object.keys(categoryKeywords).filter(k=>!rows.some(r=>r.category===k)).join(', ')}，这些不是当前五个实际目录分类。`,'区分分类、标签、建议关键词，清理空分类回退。')
issue('A08','已复现',['tesla','recessed-light'],'unknown-model-zzzz 模糊命中 tesla；wall-light 模糊命中 recessed-light，未附形状告警。','搜索可以近似；执行使用精确资产 ID，不能自动替换。')
issue('A09','代码路径差异',rows.filter(r=>r.asset.tool&&r.asset.tool!=='item').map(r=>r.assetId),'cabinet 点击目录启动 cabinet 专用工具；AI add_item 通过 ItemNode.parse 创建普通网格，摘要未传达 tool。','资产能力类型与创建工具显式登记；不能仅共用名称和 GLB。')
issue('A10','语义待复核',['toilet-paper','sunbed'],'toilet-paper 命中 toilet；sunbed 命中 bed。按名称语义可能错误继承坐便器/卧室床规则，尚未视觉验收。','盘点中保留原规则，后续通过具体功能和实际模型验证。')
const summaryText = resolver.generateCatalogSummary()
assert.equal(resolver.getAllCatalogItems().length,catalog.length)
assert.equal(new Set(rows.map(r=>r.assetId)).size,rows.length)
assert(rows.every(r=>Array.isArray(r.asset.dimensions)&&r.asset.dimensions.length===3&&r.asset.dimensions.every(n=>Number.isFinite(n)&&n>0)))
const stats = {
  assets: rows.length, categories: Object.fromEntries(categoryConfig.map(c=>[c.catalogCategory,rows.filter(r=>r.category===c.catalogCategory).length])),
  translated: rows.filter(r=>zh[r.assetId]).length, functionTagsPresent:rows.filter(r=>r.asset.functionTags?.length).length,
  placementRules:ruleRows.length, matchedPlacement:rows.filter(r=>r.placementKey!=='DEFAULT').length,
  defaultPlacement:rows.filter(r=>r.placementKey==='DEFAULT').length,
  caseInsensitiveNameCollisions:nameCollisions.length, wrongNameResolutions:rows.filter(r=>r.englishNameResolvedId!==r.assetId).length,
  shadowedDifferentRules:issues.find(i=>i.code==='A02').assetIds.length,
  mcpCount:mcp.length, mcpShared:rows.filter(r=>r.mcpAsset).length, mcpDifferent:rows.filter(r=>r.mcpDiffFields.length).length,
  localSameIdGlbs:rows.filter(r=>r.localSameIdFile).length,
  translationOrphans:Object.keys(zh).filter(id=>!rows.some(r=>r.assetId===id)),
  toolDefinitionCount:toolDefs.length, registeredNodeDefinitions:registeredDefinitionNames.length,
  summaryCharacters:summaryText.length,
  uniqueTags:Object.keys(tags).length, emptyTags:rows.filter(r=>!r.asset.tags?.length).length,
  specialToolEntries:rows.filter(r=>r.asset.tool&&r.asset.tool!=='item').length,
  dimensionsDifferentInMcp:rows.filter(r=>r.mcpDiffFields.includes('dimensions')).length,
}
const audit = {
  generatedAt:new Date().toISOString(), gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  scope:'内置目录；useScene 为空的纯逻辑执行；未进行真实 LLM、网络资源、渲染、物理测量或场景修改。',
  stats,sources,rows,rules:ruleRows,nameCollisions,categoryConfig,categoryKeywords,tags,probes,issues,
  nodeKinds,registeredDefinitionNames,tools:toolDefs.map(x=>({name:x.function.name,description:x.function.description,parameters:x.function.parameters})),
}
fs.writeFileSync(path.join(output,'audit.json'),JSON.stringify(audit,null,2)+'\n')
fs.writeFileSync(path.join(output,'ai-catalog-summary.txt'),summaryText+'\n')
assert.equal(nodeKinds.length,registeredDefinitionNames.length)
assert(nodeKinds.every(n=>n.kind))
console.log(JSON.stringify({stats,issues:issues.map(x=>({code:x.code,count:x.assetIds.length})),probeResults:probes},null,2))
