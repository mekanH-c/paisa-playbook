import { glossarySeeds } from '../data/glossary'
import { allChapters, chapterContent, loadAllContent } from '../data/curriculum'
import type { Block } from '../types'

/**
 * The glossary merges two sources:
 *
 *   1. `src/data/glossary.ts` — the hand-authored backbone.
 *   2. `terms` blocks inside authored chapters — so a term explained in a lesson
 *      shows up here too, and can link back to that chapter.
 *
 * Chapter content is code-split per level, so the caller must `await
 * prepareGlossary()` before reading entries.
 */

export type GlossaryEntry = {
  term: string
  meaning: string
  /** Chapter ids that define this term, for "read more" links. */
  chapters: string[]
  see: string[]
  key: string
}

const keyOf = (t: string) => t.trim().toLowerCase()

let entries: GlossaryEntry[] | null = null
let ready: Promise<GlossaryEntry[]> | null = null

export const prepareGlossary = (): Promise<GlossaryEntry[]> => {
  ready ??= loadAllContent().then(build)
  return ready
}

function build(): GlossaryEntry[] {
  const byKey = new Map<string, GlossaryEntry>()

  const put = (term: string, meaning: string, chapterId?: string, see: string[] = []) => {
    const key = keyOf(term)
    const existing = byKey.get(key)
    if (existing) {
      // Keep the longer (more informative) definition.
      if (meaning.length > existing.meaning.length) existing.meaning = meaning
      if (chapterId && !existing.chapters.includes(chapterId)) existing.chapters.push(chapterId)
      existing.see = Array.from(new Set([...existing.see, ...see]))
      return
    }
    byKey.set(key, { term, meaning, chapters: chapterId ? [chapterId] : [], see, key })
  }

  // 1. Seeds first, so their wording wins ties against in-chapter ones.
  for (const s of glossarySeeds) put(s.term, s.meaning, undefined, s.see ?? [])

  // 2. Chapter `terms` blocks.
  for (const ref of allChapters) {
    const ch = chapterContent[ref.id]
    if (!ch) continue
    for (const block of ch.blocks as Block[]) {
      if (block.kind !== 'terms') continue
      for (const t of block.items) put(t.term, t.meaning, ref.id)
    }
  }

  entries = [...byKey.values()].sort((a, b) => a.term.localeCompare(b.term))
  return entries
}

/** All entries, alphabetical. Requires `prepareGlossary()` first. */
export const allEntries = (): GlossaryEntry[] => entries ?? []

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

/** Ranked glossary search across term and meaning. */
export const searchGlossary = (query: string, limit = 100): GlossaryEntry[] => {
  const q = normalise(query)
  if (!q) return allEntries().slice(0, limit)

  const terms = q.split(' ').filter(Boolean)
  const scored: { e: GlossaryEntry; score: number }[] = []

  for (const e of allEntries()) {
    const tKey = normalise(e.term)
    const mKey = normalise(e.meaning)
    let score = 0

    for (const term of terms) {
      const inTerm = tKey.indexOf(term)
      const inMeaning = mKey.split(' ').some((w) => w === term || w.startsWith(term))
      if (inTerm < 0 && !inMeaning) {
        score = 0
        break
      }
      if (inTerm >= 0) score += tKey === term ? 60 : tKey.startsWith(term) ? 40 : 20
      if (inMeaning) score += 8
    }

    if (score > 0) scored.push({ e, score })
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.e)
}

/** Group entries by first letter, ignoring case and leading punctuation. */
export const groupByLetter = (
  list: GlossaryEntry[],
): { letter: string; entries: GlossaryEntry[] }[] => {
  const groups = new Map<string, GlossaryEntry[]>()
  for (const e of list) {
    const first = (e.term.match(/[a-z0-9]/i)?.[0] ?? '#').toUpperCase()
    const bucket = groups.get(first) ?? []
    bucket.push(e)
    groups.set(first, bucket)
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([letter, entries]) => ({ letter, entries }))
}

export const glossaryCount = () => allEntries().length