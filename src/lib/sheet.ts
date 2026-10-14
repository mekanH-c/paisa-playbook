/**
 * A tiny spreadsheet formula engine — enough of SUM / SUMIF / SUMIFS / IF /
 * AVERAGE / COUNT / MAX / MIN / ROUND to teach the real concepts.
 */

export type Sheet = Record<string, string>

export type CellValue = number | string | boolean | { error: string }

const colToNum = (col: string): number => {
  let n = 0
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

const numToCol = (n: number): string => {
  let s = ''
  let x = n
  while (x > 0) {
    const r = (x - 1) % 26
    s = String.fromCharCode(65 + r) + s
    x = Math.floor((x - 1) / 26)
  }
  return s
}

export { colToNum, numToCol }

const REF_RE = /^([A-Z]{1,3})([0-9]{1,5})$/

/** Every cell address that a formula touches — used for dependency highlighting. */
export function refsUsed(formula: string): { refs: string[]; ranges: [string, string][] } {
  const refs: string[] = []
  const ranges: [string, string][] = []
  const re = /([A-Z]{1,3}[0-9]{1,5})(?::([A-Z]{1,3}[0-9]{1,5}))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(formula.toUpperCase()))) {
    if (m[2]) ranges.push([m[1], m[2]])
    else refs.push(m[1])
  }
  return { refs, ranges }
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; v: string }
  | { t: 'range'; v: [string, string] }
  | { t: 'op'; v: string }
  | { t: 'fn'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' }

function tokenize(src: string): Token[] {
  // Matching happens on an upper-cased copy so keywords and refs are
  // case-insensitive, but string literals keep their original case (they are
  // sliced from `src`, not from `s`).
  const s = src.toUpperCase()
  const out: Token[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === ' ' || ch === '\t') {
      i++
      continue
    }
    if (ch === '"') {
      let j = i + 1
      let val = ''
      while (j < s.length && s[j] !== '"') {
        val += src[j]
        j++
      }
      out.push({ t: 'str', v: val })
      i = j + 1
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] ?? ''))) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      out.push({ t: 'num', v: Number(s.slice(i, j)) })
      i = j
      continue
    }
    const refMatch = /^([A-Z]{1,3}[0-9]{1,5})(:([A-Z]{1,3}[0-9]{1,5}))?/.exec(s.slice(i))
    if (refMatch && !/^(TRUE|FALSE)$/.test(refMatch[1])) {
      if (refMatch[2]) {
        out.push({ t: 'range', v: [refMatch[1], refMatch[3]] })
        i += refMatch[0].length
      } else {
        out.push({ t: 'ref', v: refMatch[1] })
        i += refMatch[0].length
      }
      continue
    }
    const wordMatch = /^[A-Z_][A-Z0-9_.]*/.exec(s.slice(i))
    if (wordMatch) {
      const w = wordMatch[0]
      if (w === 'TRUE') out.push({ t: 'num', v: 1 })
      else if (w === 'FALSE') out.push({ t: 'num', v: 0 })
      else out.push({ t: 'fn', v: w })
      i += w.length
      continue
    }
    if (ch === '(') {
      out.push({ t: 'lp' })
      i++
      continue
    }
    if (ch === ')') {
      out.push({ t: 'rp' })
      i++
      continue
    }
    if (ch === ',' || ch === ';') {
      out.push({ t: 'comma' })
      i++
      continue
    }
    const two = s.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '<>') {
      out.push({ t: 'op', v: two })
      i += 2
      continue
    }
    if ('+-*/^&=<>%'.includes(ch)) {
      out.push({ t: 'op', v: ch })
      i++
      continue
    }
    throw new Error(`Unexpected character "${ch}"`)
  }
  return out
}

const asNumber = (v: CellValue): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    const n = Number(v.replace(/[₹,\s]/g, ''))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

const isNumeric = (v: CellValue): boolean => {
  if (typeof v === 'number' || typeof v === 'boolean') return true
  if (typeof v === 'string') return v.trim() !== '' && Number.isFinite(Number(v.replace(/[₹,\s]/g, '')))
  return false
}

const flatten = (v: unknown): CellValue[] => {
  if (Array.isArray(v)) return v.flatMap(flatten)
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return [v]
  if (v && typeof v === 'object' && 'error' in (v as object)) return [v as CellValue]
  return []
}

/** Expand a range like A1:A5 into a flat list of cell values. */
export function expandRange(sheet: Sheet, range: [string, string], seen: Set<string>): CellValue[] {
  const out: CellValue[] = []
  const a = REF_RE.exec(range[0])
  const b = REF_RE.exec(range[1])
  if (!a || !b) return out
  const c1 = colToNum(a[1])
  const r1 = Number(a[2])
  const c2 = colToNum(b[1])
  const r2 = Number(b[2])
  for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      const addr = `${numToCol(c)}${r}`
      if (seen.has(addr)) continue
      out.push(evaluateCell(sheet, addr, seen))
    }
  }
  return out
}

function readRef(sheet: Sheet, addr: string, seen: Set<string>): CellValue {
  if (seen.has(addr)) return { error: '#CIRCULAR' }
  return evaluateCell(sheet, addr, seen)
}

const matchCriteria = (cell: CellValue, criteria: CellValue): boolean => {
  if (typeof criteria === 'string' && isNumeric(cell)) {
    const ops = ['<>', '>=', '<=', '>', '<', '=']
    for (const op of ops) {
      if (criteria.startsWith(op)) {
        const target = Number(criteria.slice(op.length))
        const cv = asNumber(cell)
        switch (op) {
          case '<>':
            return cv !== target
          case '>=':
            return cv >= target
          case '<=':
            return cv <= target
          case '>':
            return cv > target
          case '<':
            return cv < target
          case '=':
            return cv === target
        }
      }
    }
  }
  if (typeof criteria === 'string' && typeof cell === 'string') {
    return cell.toLowerCase().includes(criteria.toLowerCase())
  }
  return asNumber(cell) === asNumber(criteria) || String(cell) === String(criteria)
}

const FNS: Record<string, (args: unknown[]) => CellValue> = {
  SUM: (a) => a.flatMap(flatten).filter(isNumeric).reduce((n: number, v) => n + asNumber(v), 0),
  COUNT: (a) => a.flatMap(flatten).filter(isNumeric).length,
  COUNTA: (a) => a.flatMap(flatten).filter((v) => v !== '' && v !== 0).length,
  AVERAGE: (a) => {
    const nums = a.flatMap(flatten).filter(isNumeric).map(asNumber)
    return nums.length ? nums.reduce((n, x) => n + x, 0) / nums.length : { error: '#DIV/0!' }
  },
  MAX: (a) => Math.max(...a.flatMap(flatten).filter(isNumeric).map(asNumber)),
  MIN: (a) => Math.min(...a.flatMap(flatten).filter(isNumeric).map(asNumber)),
  ABS: (a) => Math.abs(asNumber(flatten(a)[0] ?? 0)),
  ROUND: (a) => {
    const v = asNumber(flatten(a[0])[0] ?? 0)
    const d = asNumber(flatten(a[1])[0] ?? 0)
    const f = 10 ** d
    return Math.round(v * f) / f
  },
  IF: (a) => {
    const [cond, yes, no] = a
    const cv = flatten(cond)[0]
    const truthy = typeof cv === 'boolean' ? cv : asNumber(cv ?? 0) !== 0
    const v = flatten(truthy ? yes : no)[0]
    return v === undefined ? 0 : v
  },
  AND: (a) => a.flatMap(flatten).every((v) => asNumber(v) !== 0),
  OR: (a) => a.flatMap(flatten).some((v) => asNumber(v) !== 0),
  SUMIF: (a) => {
    // Excel-style SUMIF(range, criteria, [sum_range]): when a third argument is
    // given we sum that range rather than the criteria range itself.
    const [range, criteria, sumRange] = a
    const crit = flatten(criteria)[0]
    const matches = flatten(range).map((c, i) => (matchCriteria(c, crit) ? i : -1)).filter((i) => i >= 0)
    if (sumRange === undefined) {
      return matches.reduce((n: number, i) => {
        const c = flatten(range)[i]
        return n + (isNumeric(c) ? asNumber(c) : 0)
      }, 0)
    }
    const sums = flatten(sumRange)
    return matches.reduce((n: number, i) => n + (isNumeric(sums[i]) ? asNumber(sums[i]) : 0), 0)
  },
  SUMIFS: (a) => {
    const [sumRange, ...pairs] = a
    const sums = flatten(sumRange)
    let total = 0
    for (let i = 0; i < sums.length; i++) {
      let ok = true
      for (let p = 0; p < pairs.length; p += 2) {
        const critRange = flatten(pairs[p])
        const crit = flatten(pairs[p + 1])[0]
        if (!matchCriteria(critRange[i] ?? '', crit)) {
          ok = false
          break
        }
      }
      if (ok && isNumeric(sums[i])) total += asNumber(sums[i])
    }
    return total
  },
  COUNTIF: (a) => {
    const [range, criteria] = a
    const crit = flatten(criteria)[0]
    return flatten(range).filter((c) => matchCriteria(c, crit)).length
  },
}

/** Evaluate a cell's raw content. Plain numbers and text pass through; "=" means formula. */
export function evaluateCell(sheet: Sheet, addr: string, seen = new Set<string>()): CellValue {
  if (seen.has(addr)) return { error: '#CIRCULAR' }
  const raw = (sheet[addr] ?? '').trim()
  if (raw === '') return ''
  if (!raw.startsWith('=')) {
    const n = Number(raw.replace(/[₹,\s]/g, ''))
    if (raw !== '' && Number.isFinite(n) && /^[-+0-9₹,.\s]+$/.test(raw)) return n
    return raw
  }
  const nextSeen = new Set(seen)
  nextSeen.add(addr)
  try {
    const tokens = tokenize(raw.slice(1))
    let pos = 0
    const peek = () => tokens[pos]
    const eat = () => tokens[pos++]

    const parseExpr = (): CellValue => parseCompare()

    const parseCompare = (): CellValue => {
      let left = parseAdd()
      while (peek()?.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes((peek() as { v: string }).v)) {
        const op = (eat() as { v: string }).v
        const right = parseAdd()
        const l = typeof left === 'boolean' ? Number(left) : asNumber(left)
        const r = typeof right === 'boolean' ? Number(right) : asNumber(right)
        left =
          op === '=' ? l === r || String(left) === String(right)
          : op === '<>' ? !(l === r || String(left) === String(right))
          : op === '<' ? l < r
          : op === '>' ? l > r
          : op === '<=' ? l <= r
          : l >= r
      }
      return left
    }

    const parseAdd = (): CellValue => {
      let left = parseMul()
      while (peek()?.t === 'op' && ['+', '-'].includes((peek() as { v: string }).v)) {
        const op = (eat() as { v: string }).v
        const right = parseMul()
        left = asNumber(left) + (op === '+' ? asNumber(right) : -asNumber(right))
      }
      return left
    }

    const parseMul = (): CellValue => {
      let left = parseUnary()
      while (peek()?.t === 'op' && ['*', '/'].includes((peek() as { v: string }).v)) {
        const op = (eat() as { v: string }).v
        const right = parseUnary()
        if (op === '*') left = asNumber(left) * asNumber(right)
        else {
          const r = asNumber(right)
          left = r === 0 ? { error: '#DIV/0!' } : asNumber(left) / r
        }
      }
      return left
    }

    const parseUnary = (): CellValue => {
      if (peek()?.t === 'op' && (peek() as { v: string }).v === '-') {
        eat()
        return -asNumber(parseUnary())
      }
      if (peek()?.t === 'op' && (peek() as { v: string }).v === '+') {
        eat()
        return parseUnary()
      }
      return parsePrimary()
    }

    const parsePrimary = (): CellValue => {
      const tok = eat()
      if (!tok) throw new Error('Unexpected end of formula')
      if (tok.t === 'num') return tok.v
      if (tok.t === 'str') return tok.v
      if (tok.t === 'ref') return readRef(sheet, tok.v, nextSeen)
      if (tok.t === 'range') return flatten(expandRange(sheet, tok.v, nextSeen))[0] ?? ''
      if (tok.t === 'lp') {
        const v = parseExpr()
        if (peek()?.t === 'rp') eat()
        return v
      }
      if (tok.t === 'fn') {
        if (peek()?.t !== 'lp') throw new Error(`${tok.v} needs parentheses`)
        eat()
        const args: unknown[] = []
        if (peek()?.t !== 'rp') {
          for (;;) {
            args.push(parseArg())
            if (peek()?.t === 'comma') {
              eat()
              continue
            }
            break
          }
        }
        if (peek()?.t === 'rp') eat()
        const fn = FNS[tok.v]
        if (!fn) return { error: `#NAME? (${tok.v})` }
        return fn(args)
      }
      throw new Error('Unexpected token')
    }

    /** Like parseExpr but keeps raw args (ranges stay ranges for SUMIF/SUMIFS). */
    const parseArg = (): unknown => {
      const tok = peek()
      if (tok?.t === 'range') {
        eat()
        return expandRange(sheet, tok.v, new Set(nextSeen))
      }
      return parseExpr()
    }

    const result = parseExpr()
    return typeof result === 'number' ? Math.round(result * 1e10) / 1e10 : result
  } catch (e) {
    return { error: `#ERROR: ${(e as Error).message}` }
  }
}

export function displayValue(v: CellValue): string {
  if (typeof v === 'object') return v.error
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}