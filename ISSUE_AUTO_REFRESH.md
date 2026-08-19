# Issue: Auto-refresh PR/branch list on branch change

## Problem

When a user switches branches, the PR list and branch list don't update automatically. The current branch indicator and associated PR remain stale
until the view is manually refreshed.

## Expected Behavior

- When a branch is switched, the tree view should automatically refresh
- The current branch indicator should move to the newly selected branch
- Any PR associated with the new branch should be highlighted
- Debug logs should show when branch change is detected and fetches complete

## Implementation Notes

1. Listen for branch change events via Git extension API
2. Update `currentBranch` in `PullRequestTreeProvider`
3. Call `refresh()` or `updateCurrentBranch()` to trigger tree update
4. Add debug logging:
   - `[DEBUG] Branch change detected: <branch-name>`
   - `[DEBUG] Starting PR/branch list refresh...`
   - `[DEBUG] PR/branch list refresh complete`

## Files to Modify

- `src/pull_request_tree_provider.ts` - Add branch change listener and debug logs
- `src/git_extension_api.ts` - Verify Git extension API is available
- `src/extension.ts` - Register branch change event listener
