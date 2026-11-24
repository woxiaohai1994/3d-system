const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const [sourceRoot, scopePath, outputPath] = process.argv.slice(2)
if (!sourceRoot || !scopePath || !outputPath) throw new Error('Arguments: source-root scope-json output-json')
const sourceDir = 'packages/editor/src/components/ai'
const sourcePath = `${sourceDir}/prompt/openai-tools.ts`
const raw = fs.readFileSync(path.join(sourceRoot, sourcePath), 'utf8')
const ast = ts.createSourceFile(sourcePath, raw, ts.ScriptTarget.Latest, true)
const selected = new Set(JSON.parse(fs.readFileSync(scopePath, 'utf8')).tools.map(tool => tool.name))

function literal(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal)
  if (ts.isObjectLiteralExpression(node)) {
    const result = Object.create(null)
    for (const member of node.properties) {
      if (!ts.isPropertyAssignment(member)) throw new Error('Expected a literal property')
      const key = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : null
      if (!key || Object.hasOwn(result, key)) throw new Error('Invalid or duplicate property')
      result[key] = literal(member.initializer)
    }
    return result
  }
  throw new Error(`Unsupported expression: ${ts.SyntaxKind[node.kind]}`)
}

function readAst(relative) {
  const text = fs.readFileSync(path.join(sourceRoot, sourceDir, relative), 'utf8')
  return ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true)
}
function cases(file) {
  const found = new Set()
  function walk(node) {
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) found.add(node.expression.text)
    ts.forEachChild(node, walk)
  }
  walk(readAst(file))
  return found
}
const validation = cases('ai-mutation-executor.ts')
const preview = cases('ai-preview-manager.ts')
const confirmation = cases('preview/confirm-operations.ts')
const typeMap = new Map()
const typeAst = readAst('types/tool-call-types.ts')
function walkTypes(node) {
  if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
    const tag = node.members.find(member => member.name?.getText(typeAst) === 'tool')
    if (tag?.type && ts.isLiteralTypeNode(tag.type) && ts.isStringLiteral(tag.type.literal)) {
      typeMap.set(tag.type.literal.text, {
        declaration: node.name?.text ?? 'inline',
        source: `${sourceDir}/types/tool-call-types.ts`,
        line: typeAst.getLineAndCharacterOfPosition(node.getStart(typeAst)).line + 1,
        fields: node.members.map(member => ({
          name: member.name?.getText(typeAst),
          optional: Boolean(member.questionToken),
          type: member.type?.getText(typeAst),
        })),
      })
    }
  }
  ts.forEachChild(node, walkTypes)
}
walkTypes(typeAst)
let array
function locate(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'OPENAI_TOOLS') array = node.initializer
  ts.forEachChild(node, locate)
}
locate(ast)
if (!array || !ts.isArrayLiteralExpression(array)) throw new Error('OPENAI_TOOLS literal not found')
const controls = new Set(['ask_user', 'propose_placement', 'confirm_preview', 'reject_preview'])
const tools = array.elements.map(node => {
  const schema = literal(node)
  const name = schema.function.name
  return {
    name,
    disposition: selected.has(name) ? 'IN_SCOPE' : 'EXCLUDED',
    executionClass: controls.has(name) ? 'CONTROL' : 'MUTATION_OR_DONOR_SPECIAL',
    source: sourcePath,
    line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
    endLine: ast.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
    sourceSchema: schema,
    sourceType: typeMap.get(name) ?? null,
    sourceDispatch: { validationCase: validation.has(name), previewCase: preview.has(name), confirmationCase: confirmation.has(name) },
    implementationStatus: 'NOT_IMPLEMENTED',
  }
})
const names = new Set(tools.map(tool => tool.name))
if (names.size !== tools.length) throw new Error('Duplicate tool name')
for (const name of selected) if (!names.has(name)) throw new Error(`Selected tool missing from source: ${name}`)
const inventory = {
  sourceCommit: execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceSha256: crypto.createHash('sha256').update(raw).digest('hex'),
  method: 'TypeScript AST literal extraction; no donor code evaluation',
  sourceToolCount: tools.length,
  selectedToolCount: tools.filter(tool => tool.disposition === 'IN_SCOPE').length,
  excludedToolCount: tools.filter(tool => tool.disposition === 'EXCLUDED').length,
  note: 'Source schemas are provenance, not the shipped capability list. Excluded names in donor descriptions must be removed when adapting selected tools.',
  tools,
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify(inventory, null, 2) + '\n')
console.log(JSON.stringify({ total: inventory.sourceToolCount, selected: inventory.selectedToolCount, excluded: inventory.excludedToolCount }))
