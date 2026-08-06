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

## Release notes

### 0.8.1

- **Fix**: all commands reported "command not found" on fresh installs. The packaged extension never shipped its
  runtime dependency (`axios` was excluded by `node_modules/**` in `.vscodeignore` + `--no-dependencies`), so
  activation threw `Cannot find module 'axios'` and no commands registered. Replaced axios with the built-in `fetch`
  (Node 18+, VS Code 1.80) — the extension now has zero runtime dependencies and the `.vsix` is self-contained.
- **Test**: `bun run test` now also loads every compiled module through a `vscode` stub (13 module-load cases) to
  guard against missing-module regressions.

### 0.8.0

- **Feat**: the repository is now auto-detected — the `rhodecode.repoid` setting is gone. On activation the extension
  reads `git config --get remote.origin.url`, matches it against the `clone_uri` of the repos you can access
  (`get_repos`), and stores the matching repo (`repo_id` + metadata) in workspace state. Handles https, ssh://, and
  scp-like remotes. Pick a different repository anytime with **Select Repository…**.
- **Feat**: the API key can come from an environment file — `RHODECODE_API_KEY` is read from the workspace `.env`
  first, then `~/.env`, then falls back to the `rhodecode.apikey` setting. Keeps the key out of a repo's
  `.vscode/settings`.
- **Design**: Settings UI now shows proper display names (Server URL, API Key) instead of raw key casing.

### 0.7.0

- **Feat**: empty API key in the Connect wizard now shows a modal with the exact steps to create a RhodeCode auth
  token (user dropdown → My Account → Auth Tokens → Create), with a Retry button that reopens the prompt.
- **Chore**: bun is now the package manager (`bun install` → `bun.lock`); scripts and lefthook hooks run through
  bun/bunx.
- **Docs**: AGENTS.md documents the lockfile-commit rule and bun toolchain; README Development section updated.

### 0.6.2

- **Fix**: extension icon. Added the top-level `icon` field (128x128 PNG) so the Extensions view shows the RhodeCode
  bubble instead of the default placeholder square. The activity-bar icon was a full-bleed SVG rect (rendered as a
  solid square when VS Code masks it monochrome) — replaced with a transparent-background bubble-only SVG.

### 0.6.1

- **Fix**: the extension now activates on fresh installs — `activationEvents` was empty, so no command or view ever
  activated it ("command 'rhodecode.selectRepository' not found"). Every contributed command is now listed.
- **Markdown linting**: enabled rumdl (`.rumdl.toml`, line width 160), `lint:md` / `format:md` scripts, and lefthook
  pre-commit + pre-push hooks (rumdl, oxlint, oxfmt). All markdown lint-clean.

### 0.6.0

- **Onboarding**: the view now shows a "Set up connection…" welcome panel when no server is configured, and a persistent
  status bar item (`RhodeCode: not connected` → click to connect) makes it obvious where to configure the server.
- **Agents support**: added `AGENTS.md` so AI coding agents (Hermes, Claude Code, Codex, OpenCode, etc.) work with the
  repo's conventions, API facts, and toolchain.

### 0.5.0

- Toolchain: migrated from eslint to oxlint + oxfmt (configs `.oxlintrc.json`, `.oxfmtrc.json`).
- README: acknowledgments section crediting dimsedane's original vscode-rhodecode.
- Added `lint` / `format` / `format:check` scripts.

### 0.4.0

- Connection wizard (Connect to RhodeCode…): format-validated server address, API key, live connection check, then a
  group/repo browser with type-to-filter and drill-down; repo saved to workspace settings.
- Branches and Tags sections in the view (from `get_repo_refs`), with open-changeset-in-browser.
- Server/repo discovery via `get_repo_groups` + `get_repos` (permission filtered).
- Tree view restructured into Pull Requests / Branches / Tags sections with a "Set up connection…" placeholder when
  unconfigured.

### 0.3.0

- Task (TODO comment) support: read tasks from the server (`get_pull_request_comments` on RhodeCode 4.6+, HTML fallback
  on older servers), resolve tasks via `resolves_comment_id`, create tasks via `comment_type='todo'`.
- Approve and Merge now warns when a pull request has open tasks before merging.
- Comment panel shows task badges, resolved state, and a task summary line.

### 0.2.0

- Modernized toolchain (TypeScript 5, VS Code 1.80+ engine, eslint, vsce).
- Added activity-bar Pull Requests view.
- Added comment thread panel with reply and mark-handled/unhandled.

### 0.0.1 (upstream)

- Original helper commands: create pull request, show pull requests, approve & merge.
