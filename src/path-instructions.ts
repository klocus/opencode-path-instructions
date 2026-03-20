/**
 * Path-Specific Instructions Plugin for OpenCode
 *
 * Mirrors GitHub Copilot's path-specific custom instructions feature.
 * Reads `*.instructions.md` files from `.github/instructions/` and
 * `.opencode/instructions/`, parses their `applyTo` glob frontmatter,
 * and injects matching instructions into the tool output the first time
 * a file matching those patterns is read, edited, or written in a session.
 *
 * Instruction file format:
 *   ---
 *   applyTo: "**\/*.ts,**\/*.tsx"
 *   ---
 *   Your instructions here...
 */

import type { Plugin } from '@opencode-ai/plugin'
import * as fs from 'node:fs'
import * as path from 'node:path'

interface InstructionFile {
  /** Glob patterns that determine when this instruction applies */
  applyTo: string[]
  /** Instruction body content (without frontmatter) */
  content: string
  /** Absolute path to the source file */
  filePath: string
  /** Display name (filename without .instructions.md) */
  name: string
}

/** File tools that operate on file paths */
const FILE_TOOLS = new Set(['edit', 'read', 'write'])

/** Marker format used to track injected instructions in message history */
const MARKER_PREFIX = 'path-instruction'

// ---------------------------------------------------------------------------
// File system utilities
// ---------------------------------------------------------------------------

function getRelativePath(directory: string, filePath: string): string {
  const normalizedDir = directory.endsWith('/') ? directory.slice(0, -1) : directory
  if (!path.isAbsolute(filePath)) return filePath
  return path.relative(normalizedDir, filePath)
}

function loadAllInstructionFiles(projectDir: string): InstructionFile[] {
  const candidateDirs = [
    path.join(projectDir, '.github', 'instructions'),
    path.join(projectDir, '.opencode', 'instructions'),
  ]
  return candidateDirs
    .filter(dir => fs.existsSync(dir))
    .flatMap(dir => loadInstructionFilesFromDir(dir))
}

function loadInstructionFilesFromDir(dir: string): InstructionFile[] {
  const results: InstructionFile[] = []

  const walk = (currentDir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.instructions.md')) {
        const parsed = parseInstructionFile(fullPath)
        if (parsed) results.push(parsed)
      }
    }
  }

  walk(dir)
  return results
}

function parseInstructionFile(filePath: string): InstructionFile | null {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return null

  const body = match[2].trim()
  if (!body) return null

  const applyTo = parseApplyTo(match[1])
  if (applyTo.length === 0) return null

  return {
    applyTo,
    content: body,
    filePath,
    name: path.basename(filePath, '.instructions.md'),
  }
}

function parseApplyTo(frontmatter: string): string[] {
  const match = frontmatter.match(/^applyTo\s*:\s*(.+)$/m)
  if (!match) return []

  let value = match[1].trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }

  return value
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Glob matching (no external dependencies)
// ---------------------------------------------------------------------------

function matchesGlob(pattern: string, filePath: string): boolean {
  return buildGlobRegex(pattern.replace(/\\/g, '/')).test(filePath.replace(/\\/g, '/'))
}

function buildGlobRegex(pattern: string): RegExp {
  let r = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        r += '(?:.+/)?'
        i += 3
      } else {
        r += '.*'
        i += 2
      }
    } else if (ch === '*') {
      r += '[^/]*'
      i++
    } else if (ch === '?') {
      r += '[^/]'
      i++
    } else if (ch === '{') {
      const close = pattern.indexOf('}', i)
      if (close === -1) {
        r += '\\{'
        i++
      } else {
        r += `(?:${pattern
          .slice(i + 1, close)
          .split(',')
          .map(escapeRe)
          .join('|')})`
        i = close + 1
      }
    } else if (ch === '[') {
      const close = pattern.indexOf(']', i)
      if (close === -1) {
        r += '\\['
        i++
      } else {
        r += pattern.slice(i, close + 1)
        i = close + 1
      }
    } else if ('.+^$|\\()'.includes(ch)) {
      r += '\\' + ch
      i++
    } else {
      r += ch
      i++
    }
  }
  return new RegExp(`^${r}$`)
}

function escapeRe(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// Marker helpers for undo-aware state sync
// ---------------------------------------------------------------------------

function makeOpenMarker(name: string): string {
  return `<${MARKER_PREFIX}:${name}>`
}

function makeCloseMarker(name: string): string {
  return `</${MARKER_PREFIX}:${name}>`
}

function extractMarkerNames(text: string): Set<string> {
  const names = new Set<string>()
  const re = new RegExp(`<${MARKER_PREFIX}:([^>/]+)>`, 'g')
  let m
  while ((m = re.exec(text)) !== null) {
    names.add(m[1])
  }
  return names
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const PathInstructionsPlugin: Plugin = async (ctx) => {
  const { directory, client } = ctx

  if (!directory || typeof directory !== 'string') {
    throw new Error(`[path-instructions] Invalid directory: ${typeof directory}`)
  }

  const projectDir = directory

  // -------------------------------------------------------------------------
  // Instance-level state (scoped to this plugin invocation)
  // -------------------------------------------------------------------------

  /** Maps sessionID → set of instruction filePaths already injected */
  const sessionInjected = new Map<string, Set<string>>()

  /** Maps callID → pending injection data (bridge between before/after hooks) */
  const pendingInjections = new Map<string, { instructions: InstructionFile[]; relativePath: string }>()

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const log = (message: string, level: 'info' | 'debug' = 'info') =>
    client.app.log({ body: { service: 'path-instructions', level, message } })

  const toast = (message: string, variant: 'info' | 'success' | 'warning' | 'error' = 'info', duration = 5000) =>
    client.tui.showToast({ body: { title: '📋 Path Instructions', message, variant, duration } })

  return {
    'tool.execute.before': async (input, output) => {
      if (!FILE_TOOLS.has(input.tool)) return

      const filePath = output.args?.filePath
      if (!filePath || typeof filePath !== 'string') return

      const relativePath = getRelativePath(projectDir, filePath)
      const sessionId = input.sessionID

      if (!sessionInjected.has(sessionId)) {
        sessionInjected.set(sessionId, new Set())
      }
      const injected = sessionInjected.get(sessionId)!
      const currentInstructions = loadAllInstructionFiles(projectDir)

      const matching = currentInstructions.filter(
        instr =>
          !injected.has(instr.filePath) &&
          instr.applyTo.some(pattern => matchesGlob(pattern, relativePath)),
      )

      if (matching.length > 0) {
        for (const instr of matching) injected.add(instr.filePath)
        pendingInjections.set(input.callID, { instructions: matching, relativePath })
        log(
          `Queued ${matching.length} instruction(s) for ${relativePath}: ${matching.map(i => i.name).join(', ')}`,
          'debug',
        )
      }
    },

    'tool.execute.after': async (input, output) => {
      const pending = pendingInjections.get(input.callID)
      if (!pending) return
      pendingInjections.delete(input.callID)

      const { instructions: matching, relativePath } = pending
      const names = matching.map(i => i.name)

      const instructionBlocks = matching
        .map(instr => {
          const patterns = instr.applyTo.join(', ')
          return [
            makeOpenMarker(instr.name),
            `Path Instructions: ${instr.name} (applies to: ${patterns})`,
            '',
            instr.content.trimEnd(),
            makeCloseMarker(instr.name),
          ].join('\n')
        })
        .join('\n\n')

      output.output =
        `${output.output}\n\n` +
        instructionBlocks

      log(`Injected path instructions for ${relativePath}: ${names.join(', ')}`)
      toast(`Injected: ${names.join(', ')} (for ${relativePath})`, 'info', 3000)
    },

    'experimental.session.compacting': async (input, output) => {
      const sessionId = input.sessionID
      const injected = sessionInjected.get(sessionId)
      if (!injected || injected.size === 0) return

      const currentInstructions = loadAllInstructionFiles(projectDir)
      const activeInstructions = currentInstructions.filter(instr => injected.has(instr.filePath))
      if (activeInstructions.length === 0) return

      const blocks = activeInstructions
        .map(instr => {
          const patterns = instr.applyTo.join(', ')
          return [
            makeOpenMarker(instr.name),
            `Path Instructions: ${instr.name} (applies to: ${patterns})`,
            '',
            instr.content.trimEnd(),
            makeCloseMarker(instr.name),
          ].join('\n')
        })
        .join('\n\n')

      output.context.push(blocks)
      log(`Preserved ${activeInstructions.length} path instruction(s) during compaction`)
    },

    event: async ({ event }) => {
      if (event.type === 'session.compacted') {
        const sessionId = (event.properties as { sessionID?: string }).sessionID
        if (sessionId) {
          sessionInjected.delete(sessionId)
          log(`Cleared injection state for session ${sessionId} after compaction — instructions will re-inject on next file access`)
          toast('Session compacted — instructions will re-inject on next file access', 'info', 3000)
        }
      }
    },

    'experimental.chat.messages.transform': async (_input, output) => {
      // Collect all instruction marker names currently present in message history.
      // If a marker has been removed (e.g. after an undo), clear its injection
      // state so the instruction gets re-injected on the next matching file access.
      const presentNames = new Set<string>()

      for (const message of output.messages) {
        for (const part of message.parts) {
          if (part.type === 'tool') {
            const toolState = part.state as { output?: string }
            if (toolState?.output) {
              for (const name of extractMarkerNames(toolState.output)) {
                presentNames.add(name)
              }
            }
          }
        }
      }

      for (const injected of sessionInjected.values()) {
        for (const filePath of Array.from(injected)) {
          const name = path.basename(filePath, '.instructions.md')
          if (!presentNames.has(name)) {
            injected.delete(filePath)
          }
        }
      }
    },
  }
}

export default PathInstructionsPlugin
