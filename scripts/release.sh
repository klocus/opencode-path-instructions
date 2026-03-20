#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/release.sh [patch|minor|major|<version>] [--no-build] [--publish] [--dry-run]
# Examples:
#   ./scripts/release.sh           # bump patch, build, push
#   ./scripts/release.sh minor     # bump minor, build, push
#   ./scripts/release.sh 1.2.3     # set explicit version
#   ./scripts/release.sh patch --no-build --publish
#   ./scripts/release.sh patch --dry-run

BUMP=${1:-patch}
SKIP_BUILD=false
DRY_RUN=false
PUBLISH=false
# parse additional flags
shift 1 || true
for arg in "$@"; do
  case "$arg" in
    --no-build) SKIP_BUILD=true;;
    --dry-run) DRY_RUN=true;;
    --publish) PUBLISH=true;;
    *) ;;
  esac
done

if [ "$DRY_RUN" = true ]; then
  echo "DRY RUN: bump=$BUMP skip_build=$SKIP_BUILD publish=$PUBLISH"
fi

# Ensure working tree is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is not clean. Commit or stash changes before releasing." >&2
  git status --porcelain
  exit 1
fi

# Bump version using npm (creates commit + tag)
echo "Running: npm version $BUMP"
if [ "$DRY_RUN" = true ]; then
  echo "DRY: npm version $BUMP -m 'chore(release): %s'"
else
  npm version "$BUMP" -m "chore(release): %s"
fi

# Build bundle (unless skipped)
if [ "$SKIP_BUILD" = false ]; then
  echo "Building bundle: npm run build:bundle"
  if [ "$DRY_RUN" = true ]; then
    echo "DRY: npm run build:bundle"
  else
    npm run build:bundle
  fi
fi

# Push commits and tags to origin
echo "Pushing commits and tags to origin"
if [ "$DRY_RUN" = true ]; then
  echo "DRY: git push origin --follow-tags"
else
  git push origin --follow-tags
fi

# Optionally publish to npm (local publish). Use with care.
if [ "$PUBLISH" = true ]; then
  echo "Publishing package to npm"
  if [ "$DRY_RUN" = true ]; then
    echo "DRY: npm publish --access public"
  else
    npm publish --access public
  fi
fi

echo "Release script finished. If your repository is configured with a publish workflow triggered by tags, the CI should run and publish the package." 
