# Path-Specific Instructions Plugin for OpenCode

Mirror of [GitHub Copilot's path-specific custom instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions#creating-path-specific-custom-instructions-1) feature. This plugin allows you to define coding rules that are only applied when working with specific files or directories.

## What it does?

The plugin automatically injects context-specific coding standards into the AI agent's context based on the files currently being read or edited. It scans your project for `*.instructions.md` files, parses their rules, and ensures they are active only for the files specified in their configuration.

## Features

- **Context-Aware Injection**: Instructions are loaded only when you start working on matching files, keeping the AI's context window clean.
- **Glob Pattern Support**: Full support for standard glob patterns to target specific directories or file types:
  - `*` for files in the current directory.
  - `**/*.ts` for recursive matching of all TypeScript files.
  - `src/**/*` for everything inside the `src` folder.
  - `{a,b}` for multiple alternatives.
- **YAML Frontmatter**: Easy configuration using standard YAML metadata at the top of instruction files.
- **Automatic Discovery**: Scans `.github/instructions/` and `.opencode/instructions/` directories automatically.
- **Agent Filtering**: Optionally restrict injection to specific agents (e.g. skip read-only agents like `explore`).
- **Configurable Trigger Tools**: Control whether instructions are injected on `read`, `edit`, `write`, or any combination.

## Installation

Add the package name to your `opencode.json`:

```json
{
  "plugin": ["@klocus/opencode-path-instructions"]
}
```

To enable agent filtering, pass options as a tuple:

```json
{
  "plugin": [
    ["@klocus/opencode-path-instructions", {
      "agents": {
        "mode": "blacklist",
        "list": ["explore", "thread", "weft"]
      }
    }]
  ]
}
```

To restrict which tool operations trigger injection, use `injectOn`:

```json
{
  "plugin": [
    ["@klocus/opencode-path-instructions", {
      "injectOn": ["edit", "write"]
    }]
  ]
}
```

Both options can be combined:

```json
{
  "plugin": [
    ["@klocus/opencode-path-instructions", {
      "agents": { "mode": "blacklist", "list": ["explore"] },
      "injectOn": ["edit", "write"]
    }]
  ]
}
```

### As a local plugin

Copy `src/path-instructions.ts` into `.opencode/plugins/` in your project:

```bash
cp src/path-instructions.ts /your-project/.opencode/plugins/path-instructions.ts
```

## How to use it?

1. **Create an instructions directory**: Create `.opencode/instructions/` (or `.github/instructions/`) in your project root.
2. **Add instruction files**: Create Markdown files ending in `.instructions.md` (e.g., `typescript.instructions.md`).
3. **Define patterns and rules**: Add YAML frontmatter at the top to specify which files the rules apply to, followed by your instructions:

```markdown
---
applyTo: "src/app/**/*.ts, src/app/**/*.html"
---

- Use OnPush change detection strategy for all new components.
- Prefer signals over observables for local state.
- Ensure all components have associated unit tests.
```

The plugin will handle the rest, notifying you via the tool output whenever path-specific instructions are applied.

## How it works

### Injection

When the AI performs an `edit`, `read` or `write` operation on a file, the plugin:

1. Finds all `*.instructions.md` files whose `applyTo` patterns match the target file path.
2. Injects them **once per session** — subsequent operations on matching files won't repeat the injection.
3. Appends the instructions to the tool output with a visible metadata header, so the AI can see which instructions were applied and follow them.

### Agent filtering

When `agents` options are provided, the plugin checks which agent is running before injecting instructions:

- **`blacklist`** mode: inject for all agents **except** those listed.
- **`whitelist`** mode: inject **only** for agents on the list.

Agent names are the built-in subagent types: `explore`, `general`, `thread`, `warp`, `weft`, `pattern`, `shuttle`, `spindle`. Sessions without an identified agent (the main session) are treated as `"main"`.

Without `agents` options (or with an empty list), the plugin injects instructions for all agents — same as original behavior.

### Controlling injection triggers (`injectOn`)

By default the plugin injects instructions when the AI performs **any** of `read`, `edit`, or `write`. You can narrow this with `injectOn`.

**Injecting only on `edit` and `write`** (omit `read`):

```json
"injectOn": ["edit", "write"]
```

**Pros:**
- Cleaner context for read-only exploration — instructions won't appear when the AI is only gathering information.
- Reduces noise in sessions dominated by reading (e.g. code review agents, analysis tasks).
- Slightly smaller context window usage on read-heavy operations.

**Cons:**
- The AI may read and immediately make decisions based on the file *before* instructions are injected. If a `read` is followed by an `edit` in the same turn, instructions will arrive only with the edit — the AI might already have formed an approach without them.
- Instructions are shown to the AI later in the conversation, which can be less effective than receiving them upfront during the read phase.
- If the AI reads a file but doesn't edit it in the same session (e.g. for reference), it will never see the applicable instructions.

**When to use `["edit", "write"]`:** Best combined with `agents` filtering — if you've already excluded pure read-only agents, restricting `injectOn` on remaining agents adds little value and carries the cons above. Most useful when you have a single mixed agent that you want to influence only at write time.

### Frontmatter notes

- `applyTo` accepts a comma-separated list of glob patterns. Values may be quoted with single or double quotes or left unquoted.
- If `applyTo` is missing or empty, the file is ignored.

### Example tool output

```
[file contents...]

<path-instruction:typescript>
Path Instructions: typescript (applies to: **/*.ts, **/*.tsx)

When writing TypeScript:
- Always use explicit return types
...
</path-instruction:typescript>
```

### Session handling

- Instructions injected in a session are tracked and not repeated.
- On **session compaction**, injection state is cleared so instructions are re-injected when files are accessed again.
- On **undo** operations that remove injected instructions from message history, the injection state is automatically reset so instructions can be re-injected.

## Releasing

A helper script is included at `scripts/release.sh` to bump the package version, build, push commits and tags, and optionally publish to npm.

Usage examples:

- Bump patch, build, push (and trigger CI publish):

  `./scripts/release.sh`

- Bump minor and publish locally after push:

  `./scripts/release.sh minor --publish`

- Explicit version, build skipped, dry run:

  `./scripts/release.sh 1.2.3 --no-build --dry-run`

Notes:

- By default the CI workflow will publish packages via Trusted Publisher (OIDC) when a `v*.*.*` tag is pushed. Use `--publish` to perform a local `npm publish` from your machine instead.
- Ensure you have permissions to publish and that your npm login is configured if using `--publish`.
