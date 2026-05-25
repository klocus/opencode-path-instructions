# Path-Specific Instructions Plugin for OpenCode

Mirror of [GitHub Copilot's path-specific custom instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions#creating-path-specific-custom-instructions-1) for OpenCode. Automatically injects coding rules into the AI's context when it reads or edits files matching configured glob patterns.

## Installation

Add to your `opencode.json`:

```json
{
  "plugin": ["@klocus/opencode-path-instructions"]
}
```

### Options

Pass options as a tuple to enable agent filtering or control injection triggers:

```json
{
  "plugin": [
    [
      "@klocus/opencode-path-instructions",
      {
        "agents": { "mode": "blacklist", "list": ["explore"] },
        "injectOn": ["edit", "write"]
      }
    ]
  ]
}
```

- **`agents`** — `mode` is `"blacklist"` (skip listed agents) or `"whitelist"` (only listed agents). The main session is identified as `"main"`.
- **`injectOn`** — which operations trigger injection: `"read"`, `"edit"`, `"write"`. Defaults to all three. OpenCode patch operations are treated as `"edit"` for updates/moves and `"write"` for new files. Deleting files does not trigger injection.

### As a local plugin

```bash
cp src/path-instructions.ts /your-project/.opencode/plugins/path-instructions.ts
```

## Usage

1. Create `.opencode/instructions/` (or `.github/instructions/`) in your project root.
2. Add `*.instructions.md` files with YAML frontmatter specifying which files they apply to:

```markdown
---
applyTo: "src/app/**/*.ts, src/app/**/*.html"
---

- Use OnPush change detection strategy for all new components.
- Prefer signals over observables for local state.
```

Instructions are injected once per session when the AI touches a matching file, then not repeated.

## Releasing

A helper script is included at `scripts/release.sh` to bump the package version, build, push commits and tags, and optionally publish to npm.

Usage examples:

- Bump patch, build, push (and trigger CI publish):

  `./scripts/release.sh`

- Explicit version, build skipped, dry run:

  `./scripts/release.sh 1.2.3 --no-build --dry-run`

Notes:

- By default the CI workflow will publish packages via Trusted Publisher (OIDC) when a `v*.*.*` tag is pushed. Use `--publish` to perform a local `npm publish` from your machine instead.
- Ensure you have permissions to publish and that your npm login is configured if using `--publish`.
