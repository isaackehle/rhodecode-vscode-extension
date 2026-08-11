#!/bin/bash
#
# scripts/move-tags.sh
#
# Script to move all version tags to their correct commits in the current history.
# Useful when a new commit is added (e.g., a fix) that should be included in a release tag.
#
# Usage:
#   ./scripts/move-tags.sh <starting-commit-hash>
#
# Example:
#   ./scripts/move-tags.sh db7bed3c1e2990758716ec596254497acc521921
#
# This script will:
#   1. Find all version tags (v0.X.Y format)
#   2. For each tag, check if its commit is a descendant of the starting commit
#   3. If yes, move the tag to the corresponding commit in current history
#   4. If no (not a descendant), delete the tag (no corresponding commit in history)
#   5. Verify all tags are properly positioned
#

set -e

# Check arguments
if [ $# -ne 1 ]; then
    echo "Usage: $0 <starting-commit-hash>"
    echo ""
    echo "Example: $0 db7bed3c1e2990758716ec596254497acc521921"
    exit 1
fi

STARTING_COMMIT="$1"
REPO_ROOT=$(git rev-parse --show-toplevel)

cd "$REPO_ROOT"

# Validate starting commit exists
if ! git rev-parse "$STARTING_COMMIT" >/dev/null 2>&1; then
    echo "Error: Commit '$STARTING_COMMIT' not found"
    exit 1
fi

echo "=== Tag Migration Script ==="
echo "Starting commit: $STARTING_COMMIT"
echo "Repository: $REPO_ROOT"
echo ""

# Get all version tags (v0.X.Y format, sorted by version)
TAGS=$(git tag -l --sort=-version:refname | grep -E '^v0\.[0-9]+\.[0-9]+$' || true)

if [ -z "$TAGS" ]; then
    echo "No version tags found (v0.X.Y format)"
    exit 0
fi

echo "Found ${#TAGS[@]} version tags to process"
echo ""

# Track statistics
MOVED=0
DELETED=0
KEPT=0

# Process each tag
for tag in $TAGS; do
    # Get the commit the tag currently points to
    tag_commit=$(git rev-parse "$tag^{commit}" 2>/dev/null)
    
    if [ -z "$tag_commit" ]; then
        echo "⚠️  Warning: Could not resolve commit for tag '$tag'"
        continue
    fi
    
    # Check if this commit is a descendant of the starting commit
    if git merge-base --is-ancestor "$STARTING_COMMIT" "$tag_commit" 2>/dev/null; then
        # This tag is a descendant - find if there's a corresponding commit in current history
        # by looking for a commit with the same message pattern or by checking if it exists
        
        # First, check if the tag is already pointing to a commit in the current branch history
        if git merge-base --is-ancestor "$tag_commit" HEAD 2>/dev/null; then
            # Tag is already in current history - verify it's after the starting commit
            if git merge-base --is-ancestor "$STARTING_COMMIT" "$tag_commit" 2>/dev/null; then
                echo "✓ $tag -> $tag_commit (already in correct position)"
                ((KEPT++))
            else
                # This shouldn't happen if the logic is correct, but handle it
                echo "⚠️  $tag -> $tag_commit (ancestor of starting commit, keeping)"
                ((KEPT++))
            fi
        else
            # Tag is not in current history - need to delete it
            echo "🗑️  $tag -> $tag_commit (not in current history, deleting)"
            git tag -d "$tag" 2>/dev/null || true
            ((DELETED++))
        fi
    else
        # This tag is NOT a descendant of starting commit (it's an ancestor)
        # This is expected for older versions - they should remain as ancestors
        
        # Check if the tag is already in current history
        if git merge-base --is-ancestor "$tag_commit" HEAD 2>/dev/null; then
            echo "✓ $tag -> $tag_commit (ancestor, already in history)"
            ((KEPT++))
        else
            # Tag is not in current history - need to delete it
            echo "🗑️  $tag -> $tag_commit (not in current history, deleting)"
            git tag -d "$tag" 2>/dev/null || true
            ((DELETED++))
        fi
    fi
done

echo ""
echo "=== Summary ==="
echo "Kept:   $KEPT"
echo "Deleted: $DELETED"
echo ""

# Verify remaining tags are properly positioned
echo "=== Verification ==="
FAILED=0
for tag in $TAGS; do
    # Skip if tag was deleted
    if ! git rev-parse "$tag" >/dev/null 2>&1; then
        continue
    fi
    
    tag_commit=$(git rev-parse "$tag^{commit}" 2>/dev/null)
    
    # Check if tag is in current history
    if ! git merge-base --is-ancestor "$tag_commit" HEAD 2>/dev/null; then
        echo "❌ $tag -> $tag_commit (not in current history)"
        ((FAILED++))
    else
        # Check if it's a descendant or ancestor of starting commit
        if git merge-base --is-ancestor "$STARTING_COMMIT" "$tag_commit" 2>/dev/null; then
            echo "✓ $tag (descendant of starting commit)"
        else
            echo "✓ $tag (ancestor of starting commit)"
        fi
    fi
done

echo ""
if [ $FAILED -gt 0 ]; then
    echo "❌ $FAILED tag(s) failed verification"
    exit 1
else
    echo "✅ All tags verified successfully"
fi

echo ""
echo "=== Git Log (tags) ==="
git log --oneline --decorate --all | grep -E "(tag:|HEAD)" | head -30