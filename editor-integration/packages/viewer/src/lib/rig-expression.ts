// SPDX-License-Identifier: GPL-3.0-or-later
/** Evaluate the arithmetic subset used by the vendored drivers without eval or dynamic code. */
export function evaluateRigExpression(
  source: string,
  variables: Record<string, number>,
  allowNonFinite = false,
): number {
  const tokens = source.match(/(?:\d*\.)?\d+(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|\*\*|[()+\-*/,]/g) ?? []
  let cursor = 0
  const priorities: Record<string, number> = { or: 1, '+': 2, '-': 2, '*': 3, '/': 3, '**': 4 }
  const read = (level = 0): number => {
    const token = tokens[cursor++]!
    let value: number
    if (token === '-' || token === '+') value = (token === '-' ? -1 : 1) * read(4)
    else if (token === '(') {
      value = read()
      if (tokens[cursor++] !== ')') throw new Error('Invalid driver parentheses')
    } else if (/^[\d.]/.test(token)) value = Number(token)
    else if (tokens[cursor] === '(') {
      cursor++
      const args = [read()]
      while (tokens[cursor] === ',') {
        cursor++
        args.push(read())
      }
      if (tokens[cursor++] !== ')') throw new Error('Invalid driver function')
      if (token === 'abs') value = Math.abs(args[0]!)
      else if (token === 'max') value = Math.max(...args)
      else if (token === 'min') value = Math.min(...args)
      else throw new Error(`Unsupported driver function ${token}`)
    } else {
      if (!(token in variables)) throw new Error(`Missing driver variable ${token}`)
      value = variables[token]!
    }
    while (cursor < tokens.length) {
      const op = tokens[cursor]!,
        priority = priorities[op] ?? 0
      if (priority <= level) break
      cursor++
      const right = read(op === '**' ? priority - 1 : priority)
      value =
        op === 'or'
          ? value || right
          : op === '+'
            ? value + right
            : op === '-'
              ? value - right
              : op === '*'
                ? value * right
                : op === '/'
                  ? value / right
                  : value ** right
    }
    return value
  }
  const result = read()
  if (cursor !== tokens.length || (!allowNonFinite && !Number.isFinite(result)))
    throw new Error('Invalid camera rig driver result')
  return result
}
