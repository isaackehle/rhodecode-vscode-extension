#!/usr/bin/env bash
set -euo pipefail

# Script to fix existing tags by recreating them with proper release comments
# Usage: ./scripts/fix-tags.sh [version] [release_comment]
#   If no version provided, shows list of tags and prompts for selection

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to list all tags
list_tags() {
    echo "Available tags:"
    echo "----------------"
    git tag -l | sort -V | while read tag; do
        commit=$(git rev-list -n 1 "$tag" 2>/dev/null || echo "unknown")
        date=$(git log -1 --format='%ai' "$tag" 2>/dev/null || echo "unknown")
        echo "  $tag (commit: ${commit:0:7}, date: $date)"
    done
}

# Function to get tag details
get_tag_info() {
    local tag="$1"
    local commit=$(git rev-list -n 1 "$tag" 2>/dev/null)
    local date=$(git log -1 --format='%ai' "$tag" 2>/dev/null)
    echo "Tag: $tag"
    echo "Commit: $commit"
    echo "Date: $date"
}

# Function to delete a tag (local and remote)
delete_tag() {
    local tag="$1"
    print_info "Deleting local tag: $tag"
    git tag -d "$tag"
    
    print_info "Deleting remote tag: $tag"
    git push origin --delete "$tag" 2>/dev/null || print_warn "Remote tag $tag not found or already deleted"
    
    print_info "Tag $tag deleted successfully"
}

# Function to create a new annotated tag
create_tag() {
    local tag="$1"
    local comment="$2"
    
    print_info "Creating annotated tag: $tag"
    print_info "Comment: $comment"
    
    git tag -a "$tag" -m "$comment"
    
    print_info "Tag $tag created successfully"
}

# Function to push a tag
push_tag() {
    local tag="$1"
    
    print_info "Pushing tag: $tag"
    git push origin "$tag"
    
    print_info "Tag $tag pushed successfully"
}

# Function to fix a single tag
fix_tag() {
    local tag="$1"
    local comment="$2"
    
    print_info "========================================"
    print_info "Fixing tag: $tag"
    print_info "========================================"
    
    # Show current tag info
    get_tag_info "$tag"
    echo ""
    
    # Confirm deletion
    print_warn "This will delete the local and remote tag $tag"
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Skipping $tag"
        return
    fi
    
    # Delete old tag
    delete_tag "$tag"
    
    # Create new tag
    create_tag "$tag" "$comment"
    
    # Push new tag
    push_tag "$tag"
    
    print_info "========================================"
    print_info "Tag $tag fixed successfully!"
    print_info "========================================"
    echo ""
}

# Main script
if [[ $# -eq 0 ]]; then
    # No arguments - list all tags and let user choose
    echo "No version specified. Listing all tags..."
    echo ""
    list_tags
    echo ""
    
    read -p "Enter version to fix (e.g., v0.8.0) or 'all' to fix all: " version
    
    if [[ "$version" == "all" ]]; then
        echo ""
        print_info "Fixing all tags..."
        echo ""
        git tag -l | sort -V | while read tag; do
            comment="Release $tag"
            fix_tag "$tag" "$comment"
        done
    elif [[ -n "$version" ]]; then
        if git rev-parse "$version" >/dev/null 2>&1; then
            read -p "Enter release comment for $version (default: 'Release $version'): " comment
            comment="${comment:-Release $version}"
            fix_tag "$version" "$comment"
        else
            print_error "Tag $version not found"
            exit 1
        fi
    else
        print_error "No version specified"
        exit 1
    fi
else
    # Version provided as argument
    version="$1"
    comment="${2:-Release $version}"
    
    if git rev-parse "$version" >/dev/null 2>&1; then
        fix_tag "$version" "$comment"
    else
        print_error "Tag $version not found"
        exit 1
    fi
fi

echo ""
print_info "Done!"