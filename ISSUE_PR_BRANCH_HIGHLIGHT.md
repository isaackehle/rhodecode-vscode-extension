# Issue: PR selection should switch to PR's branch and highlight matching branch

## Current Behavior

When a user clicks on a Pull Request in the tree view:

- The branch switches to the PR's source branch
- The branch path in the tree view does NOT update to show the PR's branch as "selected"
- The branch icon (🎯) only shows on the current git branch, not when it matches a PR

## Desired Behavior

### 1. PR Click Switches to PR's Branch

When clicking a PR item:

- Switch to the PR's source branch (same as current behavior)
- Update the tree view to show the PR's branch path as "selected"

### 2. Branch Highlighting for PRs

If the PR's last commit matches an existing branch:

- Show the branch icon (🎯) on that branch in the tree view
- Highlight it as the "active" branch

**Example Scenario:**

```text
Pull Requests
  #42: Add new feature [🎯]  ← PR is highlighted
    (clicking this switches to feature-branch)

Branches
  feature-branch [🎯]  ← This branch is now highlighted because PR #42 points here
  main
  develop
```

## Technical Requirements

1. **PR click handler**: Update to switch to PR's source branch AND update tree view
2. **Branch-PR matching**: After switching to a PR's branch, check if that branch exists in the refs
3. **Highlight logic**: Show branch icon (🎯) on branch that matches PR's source reference
4. **Tree view update**: Refresh tree after PR switch to update highlights

## Implementation Details

### PR Click Handler

```typescript
// When clicking PR #42:
1. Get PR's source.reference.name (e.g., "feature-branch")
2. Checkout that branch
3. Refresh tree view
4. If "feature-branch" exists in refs, mark it as current
```

### Branch-PR Matching Logic

```typescript
// In getBranchItems():
const prSourceBranches = this.pullRequests.map(pr => pr.source.reference.name);
const isPRBranch = prSourceBranches.includes(branchName);
return new RefItem('branch', name, sha, isCurrent || isPRBranch);
```

### Tree View State

- Track which PR is currently "active" (last clicked)
- Show 🎯 on both:
    - Current git branch
    - Branch that is source of an open PR

## Files to Modify

- `src/commands.ts` - Update `rhodecode.showComments` / PR click handler
- `src/pull_request_tree_provider.ts` - Add PR branch matching logic
- `src/model/rhodecode.ts` - Ensure `RhodeCodePullRequest.source.reference.name` is available

## Acceptance Criteria

- [ ] Clicking PR switches to PR's source branch
- [ ] Tree view updates after PR switch
- [ ] Branch matching PR's source shows 🎯 icon
- [ ] Branch path updates to reflect current branch
- [ ] PR item itself can be highlighted when active
- [ ] No duplicate 🎯 icons (only on one branch at a time)
