# Auto-Detect RhodeCode Workspace

## Overview

This document describes the automatic detection and connection flow for RhodeCode workspaces. When a user opens a workspace that is a RhodeCode repository,
the extension should detect it and guide the user through connection setup.

## Goals

1. **Seamless onboarding**: Users opening a RhodeCode repo should not need to manually search for the Connect wizard.
2. **Smart detection**: The extension should detect RhodeCode repositories by their remote URL pattern.
3. **Minimal friction**: After detecting a RhodeCode repo, prompt the user for their API key and auto-select the repository.
4. **Non-intrusive**: Only trigger when appropriate (RhodeCode repos), not for every workspace.

## Detection Logic

### Step 1: Detect RhodeCode Remote URL

When the extension activates or when a workspace folder changes:

1. Read `git config --get remote.origin.url` from the workspace root.
2. Check if the remote URL matches a RhodeCode pattern.

**RhodeCode URL patterns to detect:**

- `https://<host>/rhodecode/...` (standard web URL)
- `https://<host>/repos/...` (clone URL)
- `git@<host>:rhodecode/...` (SSH with `rhodecode` path segment)
- `ssh://git@<host>/rhodecode/...` (SSH explicit)

**Pattern matching approach:**

```typescript
function isRhodeCodeRemote(url: string): boolean {
    const lower = url.toLowerCase();
    // Check for 'rhodecode' in the path
    return /rhodecode/.test(lower);
}
```

**Edge cases:**

- If the host contains "rhodecode" but the path doesn't → not a RhodeCode repo
- If the path contains "rhodecode" but it's a submodule or nested path → still valid
- Fuzzy matching: if detection fails, don't block the user; they can still connect manually

### Step 2: Trigger Connection Wizard

If the remote URL is detected as RhodeCode:

1. Check if the user is already connected (server URL + API key configured).
2. If **not connected**:
   - Show a status bar notification: "Detected RhodeCode repository. Click to connect."
   - Or show a quick pick: "This appears to be a RhodeCode repository. Connect now?"
   - When user clicks, open the Connect wizard.

3. If **already connected**:
   - Skip the wizard and proceed directly to repository auto-detection.

### Step 3: Auto-Detect Repository

After the user provides their API key (via wizard or existing config):

1. Fetch the list of accessible repos via `get_repos()`.
2. Match the git remote URL against repo `clone_uri` values.
3. If a match is found:
   - Store the repo in workspace state.
   - Refresh the tree view.
   - Show success notification: "Connected to [repo name]".
4. If no match:
   - Show error: "Repository not found on server. Please select manually."
   - Open the repository picker.

## User Flows

### Flow A: First-time user, RhodeCode repo detected

```text
1. User opens workspace (RhodeCode repo)
2. Extension activates
3. Extension reads git remote.origin.url
4. Extension detects RhodeCode pattern
5. Extension shows notification: "Detected RhodeCode repository. Connect?"
6. User clicks notification → Connect wizard opens
7. User enters API key (server URL already known from detection)
8. Extension verifies connection
9. Extension auto-selects repository from git remote
10. Extension shows: "Connected to [repo name]"
11. Tree view loads with PRs
```

### Flow B: First-time user, RhodeCode repo detected (manual trigger)

```text
1. User opens workspace (RhodeCode repo)
2. Extension activates
3. Extension reads git remote.origin.url
4. Extension detects RhodeCode pattern
5. Extension shows notification: "Detected RhodeCode repository. Connect?"
6. User ignores notification (continues working)
7. User later clicks "Connect to RhodeCode…" from status bar or command palette
8. Extension pre-fills server URL from detected remote
9. User enters API key
10. Extension auto-selects repository
11. Extension shows: "Connected to [repo name]"
```

### Flow C: Existing user, switching to new RhodeCode repo

```text
1. User opens different workspace (RhodeCode repo)
2. Extension activates (already configured with server + API key)
3. Extension reads git remote.origin.url
4. Extension detects RhodeCode pattern
5. Extension auto-detects repository from git remote
6. Extension updates workspace state with new repo
7. Tree view refreshes with new repo's PRs
8. User sees: "Connected to [new repo name]"
```

### Flow D: User opens non-RhodeCode workspace

```text
1. User opens workspace (not a RhodeCode repo)
2. Extension activates
3. Extension reads git remote.origin.url
4. Extension does NOT detect RhodeCode pattern
5. Extension does nothing (no notification, no wizard trigger)
6. User can still manually connect if needed
```

## Implementation Details

### VS Code Events to Listen To

1. **`onActivate`**: Check the current workspace folder on extension activation.
2. **`onDidChangeWorkspaceFolders`**: Listen for workspace folder changes (user opens/closes folders).

### Configuration Settings

No new settings required. The detection is automatic and transparent.

Optional future enhancement:

- `rhodecode.autoDetectEnabled`: boolean (default: true)
- `rhodecode.autoDetectPattern`: string[] (custom URL patterns to match)

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Git remote not found | Skip detection, no notification |
| Git command fails | Skip detection, no notification |
| Remote URL doesn't match RhodeCode pattern | Skip detection, no notification |
| Server API call fails during detection | Show error, don't block user |
| Repository not found on server | Show error, open repo picker |

### Notifications

Use VS Code's notification system:

- **Info notification**: "Detected RhodeCode repository. [Connect] [Later]"
- **Success notification**: "Connected to [repo name]"
- **Error notification**: "Repository not found. Please select manually."

## Testing Strategy

### Unit Tests

1. `isRhodeCodeRemote()` function tests:
   - `https://rhodecode.example.com/rhodecode/myrepo` → true
   - `https://example.com/rhodecode/myrepo` → true
   - `git@rhodecode.example.com:myrepo.git` → false (no `rhodecode` in path)
   - `git@git.example.com:rhodecode/myrepo.git` → true
   - `https://github.com/user/repo` → false

2. `detectWorkspaceType()` function tests:
   - RhodeCode repo → returns `{ type: 'rhodecode', serverUrl: string }`
   - Non-RhodeCode repo → returns `{ type: 'other' }`
   - No git remote → returns `{ type: 'unknown' }`

### Integration Tests

1. **First-time connect flow**:
   - Mock workspace with RhodeCode remote
   - Trigger extension activation
   - Verify notification appears
   - Simulate user clicking "Connect"
   - Verify wizard opens with pre-filled server URL

2. **Existing user flow**:
   - Configure server + API key in test
   - Mock workspace with RhodeCode remote
   - Trigger activation
   - Verify auto-detection succeeds
   - Verify repo is stored in workspace state

3. **Non-RhodeCode workspace**:
   - Mock workspace with GitHub remote
   - Trigger activation
   - Verify no notification appears
   - Verify no wizard trigger

4. **Workspace switch flow**:
   - Configure server + API key
   - Load workspace 1 (RhodeCode repo A)
   - Switch to workspace 2 (RhodeCode repo B)
   - Verify auto-detection updates repo state

## Future Enhancements

1. **Smart server URL pre-fill**: When detecting `git@server:rhodecode/repo`, pre-fill server URL as `https://server`.
2. **Multiple RhodeCode servers**: Support detecting which server a repo belongs to and switch client accordingly.
3. **Repository group detection**: If user has access to multiple groups, show a picker for the group.
4. **Caching**: Cache detected server URLs to avoid repeated git remote reads.

## Dependencies

- `gitRemote.ts`: Already has `getGitRemoteUrl()` function
- `configuration.ts`: Already has server URL / API key accessors
- `repoState.ts`: Already has repo storage functions
- `serverSetup.ts`: Already has Connect wizard implementation

## Success Criteria

- [ ] Extension detects RhodeCode repos automatically
- [ ] Notification appears only for RhodeCode repos
- [ ] Connect wizard pre-fills server URL from detected remote
- [ ] Repository auto-selects after API key entry
- [ ] No notifications for non-RhodeCode repos
- [ ] All unit and integration tests pass
- [ ] Markdown linting passes (`bun run lint:md`)
