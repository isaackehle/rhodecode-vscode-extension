# Release Scripts

This directory contains scripts for managing releases of the RhodeCode VS Code Extension.

## Scripts

### `release.sh` - Automated Release Script

Bumps version, updates CHANGELOG, commits, creates tag, and pushes to remote.

**Usage:**

```bash
# Release a minor version (default)
./scripts/release.sh

# Release a major version
./scripts/release.sh major

# Release a patch version
./scripts/release.sh patch
```

**What it does:**

1. Validates working tree is clean
2. Reads current version from `package.json`
3. Calculates new version (major.minor.patch)
4. Updates `CHANGELOG.md` with new release header
5. Commits changes with message `chore(release): bump version to X.Y.Z`
6. Creates annotated tag `vX.Y.Z`
7. Pushes to remote
8. GitHub Actions automatically creates the release with .vsix attachment

### `fix-tags.sh` - Fix Existing Tags

Recreates existing tags with proper release comments and pushes them.

**Usage:**

```bash
# Interactive mode - list all tags and choose
./scripts/fix-tags.sh

# Fix a specific tag
./scripts/fix-tags.sh v0.8.0

# Fix all tags
./scripts/fix-tags.sh all
```

**What it does:**

1. Deletes local and remote tag
2. Creates new annotated tag with proper release comment
3. Pushes new tag to remote
4. GitHub Actions automatically creates the release with .vsix attachment

## Workflow

### Creating a New Release

```bash
# 1. Make your changes and commit them
git add .
git commit -m "feat: add new feature"

# 2. Run the release script
./scripts/release.sh minor  # or major/patch

# 3. Done! GitHub Actions will create the release automatically
```

### Fixing Existing Tags

If you need to recreate tags (e.g., they were created without proper comments):

```bash
# Fix a specific tag
./scripts/fix-tags.sh v0.8.0 "Release v0.8.0"

# Fix all tags
./scripts/fix-tags.sh all
```

## GitHub Actions

The [release workflow](../.github/workflows/release.yml) triggers on tag push and:

1. Builds the extension
2. Creates GitHub Release
3. Attaches .vsix file
4. Includes CHANGELOG entry in release body

## Version Numbering

Follows [Semantic Versioning](https://semver.org/):

- **Major**: Breaking changes
- **Minor**: New features (backward compatible)
- **Patch**: Bug fixes (backward compatible)

## Notes

- All tags must start with `v` (e.g., `v0.12.1`)
- CHANGELOG entries should use the `v` prefix
- The release script automatically formats CHANGELOG entries
