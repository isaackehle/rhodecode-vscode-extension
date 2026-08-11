# RhodeCode VS Code Extension

Work with [RhodeCode](https://rhodecode.com/) pull requests from Visual Studio Code: view the comment thread, reply to
comments, and mark comments as handled — plus the original helper commands (create PR, approve & merge).

## Acknowledgments

This extension began as a fork of [dimsedane/vscode-rhodecode](https://github.com/dimsedane/vscode-rhodecode) (MIT). Thank
you to **dimsedane** for the original helper commands (create pull request, show pull requests, approve & merge) that this
project builds on — the connection wizard, repository browser, branch view, and comment/task features were all added on
top of that foundation.

## Features

- **Connect to RhodeCode…** — guided setup: enter the server address (format-validated, bare hosts get `https://`), paste
  your API key, and the extension verifies the connection against the server before offering anything.
- **Select Repository…** — browse the repository groups and repositories you have access to (server-side permission
  filtered), with type-to-filter and drill-down into groups. Selecting a repo saves it to your workspace settings and
  reloads the view.
- **Branches & Tags** — the view shows branches and tags of the selected repository (name + short commit), with
  open-in-browser for any ref.
- **Pull Request view** — pull requests with status and review status.
- **Show comments** — the full comment thread for a pull request (author, date, vote/status change, text). Works for any
  PR you pick interactively — no PR id in settings.
- **Tasks (TODO comments)** — task comments show a **TASK** badge with open/resolved state. Resolve a task from the panel
  (posts a resolving comment server-side, unblocking the merge). Create new tasks too.
- **Reply** — post a reply to the pull request thread from the panel or the command palette.
- **Mark handled / unhandled** — toggle a local "handled" flag per comment (stored in VS Code workspace state; see note
  below).
- **Approve and Merge** — warns when the PR has open tasks (RhodeCode blocks merging while tasks are unresolved), then
  approves (if needed) and merges.
- **Create Pull Request** — helper to create a PR by source/target branch.

## Requirements

A RhodeCode server with API access and an API key for your user.

## First run on a new machine

Everything happens from the **RhodeCode activity-bar icon** (the comment-bubble icon in the left bar):

1. Open the **RhodeCode** view (click the icon). If you haven't connected yet, the view shows a **"Set up connection…"**
   panel — click it.
2. Enter your server address (e.g. `rhodecode.example.com` or `https://rhodecode.example.com:8443`).
3. Enter your API key (from your user profile on the RhodeCode server).
4. Pick a repository from the browser — done.

You can also start the wizard at any time from:

- the command palette: **RhodeCode: Connect to RhodeCode…** (Ctrl/Cmd+Shift+P → type "RhodeCode")
- the **status bar**: the extension shows a persistent `RhodeCode: not connected` item at the bottom left — click it

After connecting, the status bar shows the selected repository and clicking it re-opens the repo browser. Settings are
persisted automatically (`rhodecode.serverurl` / `rhodecode.apikey` globally, `rhodecode.repoid` in the workspace).

## Configuration

Server URL and API key can be set through **Connect to RhodeCode…** (recommended), or as settings:

| Setting               | Where       | Description                                                                                 |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `rhodecode.serverurl` | User/global | Your RhodeCode server URL (e.g. `https://rhodecode.example.com`)                            |
| `rhodecode.apikey`    | User/global | Your RhodeCode API key (ignored while `rhodecode.apikeyFromEnv` is enabled)                 |

The repository is **auto-detected**: on activation the extension reads `git config --get remote.origin.url` and matches
it against the `clone_uri` of the repos you can access (via `get_repos`), then stores the matching `repo_id` and
metadata in workspace state. No `repoid` setting exists anymore — pick a different repository with
**Select Repository…** whenever you need to override the detection.

Optional:

| Setting                             | Default | Description                                                                                     |
| ----------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `rhodecode.markHandledPostsComment` | `false` | Also post a "Marked as handled" reply comment on the PR thread when you mark a comment handled. |
| `rhodecode.apikeyFromEnv`           | `false` | Read the API key from a `.env` file instead of the `rhodecode.apikey` setting.                  |

### API key from an environment file

Storing the API key in the `rhodecode.apikey` setting risks committing it to a repo's `.vscode/settings`. To avoid
that, enable the `rhodecode.apikeyFromEnv` setting: the extension then reads `RHODECODE_API_KEY` from a `.env` file
(workspace/project directory first, `~/.env` second) and ignores the `rhodecode.apikey` setting entirely.

```shell
# .env in your project root (make sure it is gitignored)
RHODECODE_API_KEY=your-api-key
```

- When enabled and no env-file key is found, the extension shows an error telling you exactly what to add — it does
  not fall back to the setting or prompt.
- The Connect wizard detects an env-file key and lets you keep it or type a different one; a typed key is used for the
  session only and is not written to settings.
- `~/.env` is never part of a repo, and the project `.gitignore` in this repo already excludes `.env`.

## How comments work

- **Listing**: RhodeCode 4.6+ exposes `get_pull_request_comments`, which this extension uses first — it returns structured
  comments including `comment_type` (`note`/`todo`) and the resolved state (`comment_resolved_by`). On older servers the
  extension falls back to fetching the pull request page HTML (`?api_key=...`) and parsing the rendered comment blocks
  (TODO comments are detected via `data-comment-type="todo"` / resolved markers).
- **Replying**: uses the `comment_pull_request` API method (creates a new comment on the PR thread).
- **Resolving a task**: `comment_pull_request` with `resolves_comment_id=<todo comment id>`. The server creates a resolving
  comment and marks the task done, which is what unblocks merging.
- **Creating a task**: `comment_pull_request` with `comment_type='todo'`.
- **Marking handled**: tracked locally in VS Code workspace state, keyed by repo + PR + comment ID. RhodeCode has no
  server-side "resolved" flag for plain comments, so handled state does not appear on the RhodeCode web UI (unless you
  enable `markHandledPostsComment`). This is distinct from tasks — tasks are real server-side state.

## Development

```shell
bun install
bun run compile      # tsc -> out/
bun run lint         # oxlint src
bun run format       # oxfmt (write) src
bun run package      # vsce package -> .vsix
```

> bun is the package manager (lockfile: `bun.lock`). `npm run ...` works too — the scripts are identical.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full history of changes.
