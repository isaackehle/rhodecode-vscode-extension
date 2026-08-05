# Change Log

## 0.6.0 - 2026-08-05

- Onboarding: "Set up connection…" welcome panel in the view when unconfigured; persistent status bar item showing connection state (click to connect / switch repo).
- Agents support: added AGENTS.md with repo conventions, RhodeCode API facts, and toolchain notes.

## 0.5.0 - 2026-08-05

- Toolchain: migrated from eslint to oxlint + oxfmt (configs `.oxlintrc.json`, `.oxfmtrc.json`).
- README: acknowledgments section crediting dimsedane's original vscode-rhodecode.
- Added `lint` / `format` / `format:check` scripts.

## 0.4.0 - 2026-08-05

- Connection wizard (Connect to RhodeCode…): format-validated server address, API key, live connection check, then a group/repo browser with type-to-filter and drill-down; repo saved to workspace settings.
- Branches and Tags sections in the view (from `get_repo_refs`), with open-changeset-in-browser.
- Server/repo discovery via `get_repo_groups` + `get_repos` (permission filtered).
- Tree view restructured into Pull Requests / Branches / Tags sections with a "Set up connection…" placeholder when unconfigured.

## 0.3.0 - 2026-08-05

- Task (TODO comment) support: read tasks from the server (`get_pull_request_comments` on RhodeCode 4.6+, HTML fallback on older servers), resolve tasks via `resolves_comment_id`, create tasks via `comment_type='todo'`.
- Approve and Merge warns when a pull request has open tasks before merging.
- Comment panel shows task badges, resolved state, and a task summary line.

## 0.2.0 - 2026-08-05

- Modernized toolchain: TypeScript 5, VS Code engine ^1.80, eslint, @vscode/vsce, axios 1.x.
- Added activity-bar Pull Requests view (status + review status icons).
- Added comment thread panel with reply and mark-handled/unhandled.
- Added local handled-state storage (`workspaceState`) with optional reply-comment toggle.
