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
- **No External Dependencies**: Self-contained, no `npm install` required in your project.

## Installation

### As an npm package

Add the package name to your `opencode.json`:

```json
{
  "plugin": ["@klocus/opencode-path-instructions"]
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

When the AI performs a `read`, `edit`, or `write` operation on a file, the plugin:

1. Finds all `*.instructions.md` files whose `applyTo` patterns match the target file path.
2. Injects them **once per session** — subsequent operations on matching files won't repeat the injection.
3. Appends the instructions to the tool output with a visible metadata header, so the AI can see which instructions were applied and follow them.

### Loading

- The plugin scans `.github/instructions/` and `.opencode/instructions/` recursively at startup.
- Changes to instruction files are picked up on restart.

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

  ./scripts/release.sh

- Bump minor and publish locally after push:

  ./scripts/release.sh minor --publish

- Explicit version, build skipped, dry run:

  ./scripts/release.sh 1.2.3 --no-build --dry-run

Notes:
- By default the CI workflow will publish packages via Trusted Publisher (OIDC) when a `v*.*.*` tag is pushed. Use `--publish` to perform a local `npm publish` from your machine instead.
- Ensure you have permissions to publish and that your npm login is configured if using `--publish`.

