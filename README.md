# RhodeCode VS Code Extension

Work with [RhodeCode](https://rhodecode.com/) pull requests from Visual Studio Code: view the comment thread, reply to comments, and mark comments as handled — plus the original helper commands (create PR, approve & merge).

Forked from [dimsedane/vscode-rhodecode](https://github.com/dimsedane/vscode-rhodecode) (MIT).

## Features

- **Pull Request view** — activity-bar view listing open pull requests with status and review status.
- **Show comments** — opens a panel with the full comment thread for a pull request (author, date, vote/status change, text).
- **Reply** — post a reply to the pull request thread from the panel or the command palette.
- **Mark handled / unhandled** — toggle a local "handled" flag per comment (stored in VS Code workspace state; see note below).
- **Create Pull Request** — helper to create a PR by source/target branch.
- **Approve and Merge** — approve (if needed) and merge from the view or command palette.

## Requirements

A RhodeCode server with API access and an API key for your user.

## Configuration

Three settings are required (first use of a command will prompt for them):

| Setting | Where | Description |
| --- | --- | --- |
| `rhodecode.serverurl` | User/global | Your RhodeCode server URL (e.g. `https://rhodecode.example.com`) |
| `rhodecode.apikey` | User/global | Your RhodeCode API key |
| `rhodecode.repoid` | Workspace | The repository to use (name or ID) |

Optional:

| Setting | Default | Description |
| --- | --- | --- |
| `rhodecode.markHandledPostsComment` | `false` | Also post a "Marked as handled" reply comment on the PR thread when you mark a comment handled. |

## How comments work (important)

The RhodeCode JSON-RPC API has no "list comments" or "resolve comment" methods. This extension works around that:

- **Listing**: it fetches the pull request page HTML (`?api_key=...`) and parses the rendered comment blocks.
- **Replying**: uses the `comment_pull_request` API method (creates a new comment on the PR thread).
- **Marking handled**: tracked locally in VS Code workspace state, keyed by repo + PR + comment ID. RhodeCode itself has no server-side "resolved" flag that the API can set, so handled state does not appear on the RhodeCode web UI (unless you enable `markHandledPostsComment`).

## Development

```shell
npm install
npm run compile      # tsc -> out/
npm run package      # vsce package -> .vsix
```

## Release notes

### 0.2.0

- Modernized toolchain (TypeScript 5, VS Code 1.80+ engine, eslint, vsce).
- Added activity-bar Pull Requests view.
- Added comment thread panel with reply and mark-handled/unhandled.

### 0.0.1 (upstream)

- Original helper commands: create pull request, show pull requests, approve & merge.
