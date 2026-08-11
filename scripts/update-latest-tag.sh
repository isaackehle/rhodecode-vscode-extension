#!/bin/bash
#
# scripts/update-latest-tag.sh
#
# Script to update the latest version tag to point to a specific commit.
# Useful after making a fix that should be included in the next release.
#
# Usage:
#   ./scripts/update-latest-tag.sh <commit-hash>
#
# Example:
#   ./scripts/update-latest-tag.sh db7bed3c1e2990758716ec596254497acc521921
#
# This script will:
#   1. Find the latest version tag (highest v0.X.Y)
#   2. Move it to point to the specified commit
#   3. Verify the tag is correctly positioned
#

set -e

# Check arguments
if [ $# -ne 1 ]; then
    echo "Usage: $0 <commit-hash>"
    echo ""
    echo "Example: $0 db7bed3c1e2990758716ec596254497acc521921"
    exit 1
fi

TARGET_COMMIT="$1"
REPO_ROOT=$(git rev-parse --show-toplevel)

cd "$REPO_ROOT"

# Validate target commit exists
if ! git rev-parse "$TARGET_COMMIT" >/dev/null 2>&1; then
    echo "Error: Commit '$TARGET_COMMIT' not found"
    exit 1
fi

echo "=== Update Latest Tag Script ==="
echo "Target commit: $TARGET_COMMIT"
echo "Repository: $REPO_ROOT"
echo ""

# Get the latest version tag
LATEST_TAG=$(git tag -l --sort=-version:refname | grep -E '^v0\.[0-9]+\.[0-9]+$' | head -1)

if [ -z "$LATEST_TAG" ]; then
    echo "Error: No version tags found (v0.X.Y format)"
    exit 1
fi

echo "Current latest tag: $LATEST_TAG"

# Get the commit the latest tag currently points to
CURRENT_TAG_COMMIT=$(git rev-parse "$LATEST_TAG^{commit}")
echo "Current tag points to: $CURRENT_TAG_COMMIT"

# Check if the target commit is in the current branch history
if ! git merge-base --is-ancestor "$TARGET_COMMIT" HEAD 2>/dev/null; then
    echo "Error: Target commit is not in the current branch history"
    exit 1
fi

# Check if the target commit is different from current tag
if [ "$TARGET_COMMIT" = "$CURRENT_TAG_COMMIT" ]; then
    echo "Target commit is already the tag's commit. Nothing to do."
    exit 0
fi

# Get the tag message (if it's an annotated tag)
TAG_MESSAGE=$(git cat-file -p "$LATEST_TAG" 2>/dev/null | grep "^object" -A 1 | tail -1 || echo "")

if [ -n "$TAG_MESSAGE" ]; then
    echo "Current tag message: $TAG_MESSAGE"
fi

echo ""
echo "Moving tag '$LATEST_TAG' from '$CURRENT_TAG_COMMIT' to '$TARGET_COMMIT'"
echo ""

# Move the tag
git tag -f "$LATEST_TAG" -m "Updated to $TARGET_COMMIT" "$TARGET_COMMIT"

echo ""
echo "=== Verification ==="

# Verify the tag now points to the correct commit
NEW_TAG_COMMIT=$(git rev-parse "$LATEST_TAG^{commit}")
if [ "$NEW_TAG_COMMIT" = "$TARGET_COMMIT" ]; then
    echo "✓ Tag '$LATEST_TAG' now points to: $NEW_TAG_COMMIT"
else
    echo "❌ Error: Tag '$LATEST_TAG' points to: $NEW_TAG_COMMIT (expected: $TARGET_COMMIT)"
    exit 1
fi

# Verify the tag is in current history
if git merge-base --is-ancestor "$NEW_TAG_COMMIT" HEAD 2>/dev/null; then
    echo "✓ Tag is in current branch history"
else
    echo "❌ Error: Tag is not in current branch history"
    exit 1
fi

echo ""
echo "=== Git Log ==="
git log --oneline --decorate --all | head -10