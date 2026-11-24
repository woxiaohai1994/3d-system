import { OPENAI_TOOLS } from './prompt/openai-tools'

export const toolDefinitions = [
  ...OPENAI_TOOLS.map((entry) => entry.function),
  {
    name: 'plugin_action',
    description:
      'Create or edit an object through an installed plugin. Available plugin IDs, actions and input fields are listed in scene context. Use only listed actions; do not invent plugin IDs or parameters. Result uses the normal scene preview, confirmation and undo flow.',
    parameters: {
      type: 'object',
      properties: {
        pluginId: { type: 'string' },
        action: { type: 'string' },
        input: { type: 'object' },
      },
      required: ['pluginId', 'action', 'input'],
    },
  },
]
export const fullToolNames = toolDefinitions.map((entry) => entry.name)
const schemas = new Map(toolDefinitions.map((entry) => [entry.name, entry.parameters]))

function matches(value: unknown, schema: Record<string, unknown>, depth = 0): boolean {
  if (depth > 12) return false
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' && value.length <= 16_000
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array': {
      if (!Array.isArray(value) || value.length > 200) return false
      const items = schema.items as Record<string, unknown> | undefined
      return !items || value.every((item) => matches(item, items, depth + 1))
    }
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const object = value as Record<string, unknown>
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
      if (!properties) return Object.keys(object).length <= 100
      const required = schema.required as string[] | undefined
      if (required?.some((key) => !(key in object))) return false
      return Object.entries(object).every(
        ([key, child]) => properties[key] && matches(child, properties[key], depth + 1),
      )
    }
    default:
      return true
  }
}

export function validateToolArguments(
  name: string,
  input: Record<string, unknown>,
  depth = 0,
): boolean {
  if (depth > 5) return false
  const schema = schemas.get(name)
  if (!schema || (name !== 'batch_operations' && !matches(input, schema))) return false
  for (const [key, value] of Object.entries(input)) {
    if (
      ['position', 'rotation', 'scale'].includes(key) &&
      Array.isArray(value) &&
      value.length !== (name === 'insert_room_preset' && key === 'position' ? 2 : 3)
    )
      return false
    if (['start', 'end'].includes(key) && Array.isArray(value) && value.length !== 2) return false
    if (
      ['polygon', 'hole'].includes(key) &&
      Array.isArray(value) &&
      (value.length < 3 || value.some((point) => !Array.isArray(point) || point.length !== 2))
    )
      return false
  }
  if (name === 'batch_operations') {
    // Validate the envelope against the advertised contract, then each operation
    // against its own schema (the batch's shared fields are not exhaustive).
    const properties = schema.properties as Record<string, Record<string, unknown>>
    if (
      !matches(input, { ...schema, properties: { ...properties, operations: { type: 'array' } } })
    )
      return false
    const itemSchema = properties.operations?.items as Record<string, unknown>
    const itemProperties = itemSchema.properties as Record<string, Record<string, unknown>>
    const allowedTypes = itemProperties.type?.enum as string[]
    const operations = input.operations
    return (
      Array.isArray(operations) &&
      operations.length > 0 &&
      operations.length <= 50 &&
      operations.every((entry) => {
        if (!entry || typeof entry !== 'object') return false
        const { type, ...args } = entry
        return (
          typeof type === 'string' &&
          allowedTypes.includes(type) &&
          validateToolArguments(type, args, depth + 1)
        )
      })
    )
  }
  return true
}
