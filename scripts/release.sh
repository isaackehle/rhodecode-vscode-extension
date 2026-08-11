#!/usr/bin/env bash
set -euo pipefail

# Release script for rhodecode-vscode-extension
# Usage: ./scripts/release.sh [major|minor|patch]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

# Default to minor bump if no argument provided
VERSION_BUMP="${1:-minor}"

# Get current version from package.json
CURRENT_VERSION=$(grep -o '"version": "[^"]*"' package.json | cut -d'"' -f4)
if [[ -z "$CURRENT_VERSION" ]]; then
    echo "Error: Could not find version in package.json"
    exit 1
fi

echo "Current version: $CURRENT_VERSION"
echo "Bumping: $VERSION_BUMP"

# Calculate new version using npm version command
NEW_VERSION=$(npm version "$VERSION_BUMP" --no-git-tag-version --no-commit-hooks)

if [[ -z "$NEW_VERSION" ]]; then
    echo "Error: Failed to calculate new version"
    exit 1
fi

echo "New version: $NEW_VERSION"

# Update CHANGELOG.md
CHANGELOG_FILE="CHANGELOG.md"
TEMP_FILE=$(mktemp)

# Insert new release header after the first line (title)
head -1 "$CHANGELOG_FILE" > "$TEMP_FILE"
echo "" >> "$TEMP_FILE"
echo "## $NEW_VERSION - $(date +%Y-%m-%d)" >> "$TEMP_FILE"
echo "" >> "$TEMP_FILE"
grep -A 1000 "^## 0.8.7" "$CHANGELOG_FILE" >> "$TEMP_FILE"

mv "$TEMP_FILE" "$CHANGELOG_FILE"

# Add and commit changes
git add CHANGELOG.md package.json
git commit -m "chore(release): bump version to $NEW_VERSION"

# Create annotated tag
git tag -a "$NEW_VERSION" -m "Release $NEW_VERSION"

echo ""
echo "✓ Release $NEW_VERSION created successfully"
echo ""
echo "Next steps:"
echo "  git push && git push --tags"
