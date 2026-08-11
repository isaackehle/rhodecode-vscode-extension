# Change Log

## v0.12.1 - 2026-08-11

- **Chore**: Release v0.12.1 (version bump only).

## v0.12.0 - 2026-08-11

- **Feat**: Add GitHub Actions workflow for automated releases on tag push. Creates GitHub Release with `.vsix` attachment automatically.

## v0.11.0 - 2026-08-07

- **Feat**: Repository browser panel (#13). A new webview panel shows the current server URL,
  connected repository, groups, and all accessible repositories. Users can click on any repository
  to switch to it, with the selection persisted across sessions. The panel provides a visual interface
  for browsing and managing repository connections.

## v0.10.1 - 2026-08-07

- **Lint**: Remove redundant `activationEvents` from `package.json` (#14). VS Code 1.74+ auto-generates
  activation events from contribution declarations, making the explicit array optional.

## v0.10.0 - 2026-08-07

- **Feat**: Push tips notification (#6). After pushing a branch, the extension shows a notification offering to open
  the existing pull request or create a new one. Skips default branches (master/main/trunk). Configurable via
  `rhodecode.pushTips` setting (defaults to `true`). Includes push detection logic with unit tests.

## v0.9.5 - 2026-08-07

- **Fix**: Implement `rhodecode.markHandledPostsComment` setting. When enabled,
  marking a comment as handled now posts a "Marked as handled" reply comment to
  the PR thread so the handled state is visible on the RhodeCode server. When
  disabled (default), handled state is tracked locally only.
- **Fix**: Remove symlinks from `.claude/skills/` that caused `EISDIR` errors
  during vsce's secretlint scan on Windows. The symlinks pointed to directories,
  which caused "error occurred while scanning secrets (files)" errors.
- **Chore**: Update `.vscodeignore` and `.secretlintrc.json` to explicitly
  exclude `.claude/skills` directory.

## v0.9.4 - 2026-08-07

- Fix: Add AI agent directories (`.hermes/**`, `.claude/**`, `.agents/**`) and related files (`.secretlintrc.json`,
  `.clineignore`, `skills-lock.json`) to `.vscodeignore` to prevent vsce's secretlint from encountering symlinks
  pointing to directories, which caused "EISDIR: illegal operation on a directory, read" errors on Windows during
  `bun run package`.

## v0.9.3 - 2026-08-07

- Fix: Add `.gitattributes` file to ensure consistent line endings across platforms and prevent Windows "scanning secrets" errors during build.
- Fix: Improve Windows compatibility in `src/envfile.ts` by checking file existence before reading `.env` files to avoid permission errors.

## v0.9.2 - 2026-08-07

## v0.9.1 - 2026-08-07

- **Chore**: Version bump for v0.9.1.

## v0.9.0 - 2026-08-07

- **Chore**: Version bump for v0.9.0.

## v0.8.7 - 2026-08-07

- **Chore**: add `bun run clean` script to remove build/test artifacts (`out/`, `.vscode-test/`, `.rumdl_cache/`,
  `*.vsix`). Uses `find -delete` instead of a `*.vsix` glob so it doesn't fail under shells (e.g. zsh) that error
  on an unmatched glob.

## v0.8.6 - 2026-08-07

- **Test**: fixed `scripts/test-configuration.cjs` — the `getApiKeyRaw returns undefined (no env file)` case read the
  real `~/.env` via `os.homedir()` without mocking it, so it failed on any machine (e.g. WSL) that has a real
  `RHODECODE_API_KEY` set up for the `apikeyFromEnv` feature. The test now stubs `os.homedir()` to a directory
  guaranteed to have no `.env`, making it hermetic regardless of the host machine.

## v0.8.5 - 2026-08-07

- **Chore**: `vscode:prepublish` now runs `bun run compile` instead of `npm run compile`, matching the rest of the
  toolchain (bun is the repo's preferred package manager).

## v0.8.4 - 2026-08-06

- **Feat**: Auto-detect RhodeCode workspaces. When opening a workspace, the extension now checks if the git remote is a
  RhodeCode repository (`/rhodecode/` or `:rhodecode/` pattern). If not connected, shows a notification:
  "Detected a RhodeCode repository. Connect now?" Clicking "Connect" pre

## v0.8.3 - 2026-08-06

- **Test**: add manifest consistency check (activationEvents vs contributes.commands vs registerCommand).

## v0.8.2 - 2026-08-06

- **Feat**: API key from `.env` file support (`rhodecode.apikeyFromEnv`).
- **Fix**: drop axios, use built-in fetch (#5).

## v0.8.1 - 2026-08-05

- **Feat**: auto-detect repository from git remote (#4).
- **Feat**: read API key from `.env` file (#2).
- **Feat**: capitalize configuration labels (#3).

## v0.8.0 - 2026-08-05

- **Release**: v0.8.0.

## v0.7.0 - 2026-08-05

- **Feat**: empty API key in the Connect wizard now shows a modal with the exact steps to create a RhodeCode auth token
  (user dropdown → My Account → Auth Tokens → Create), with a Retry button that reopens the prompt.
- **Chore**: bun is now the package manager (`bun install` → `bun.lock`); scripts and lefthook hooks run through bun/bunx.
- **Docs**: AGENTS.md documents the lockfile-commit rule and bun toolchain; README Development section updated.

## v0.6.2 - 2026-08-05

- **Fix**: extension icon. Added the top-level `icon` field (128x128 PNG) so the Extensions view shows the RhodeCode
  bubble instead of the default placeholder square. The activity-bar icon was a full-bleed SVG rect (rendered as a
  solid square when VS Code masks it monochrome) — replaced with a transparent-background bubble-only SVG.

## v0.6.1 - 2026-08-05

- **Fix**: extension now activates on fresh installs. `activationEvents` was an empty array, so no contributed command or
  view ever activated the extension ("command 'rhodecode.selectRepository' not found"). Now lists every contributed
  command plus `onView:rhodecode.pullRequests`.
- **Markdown linting enabled**: `.rumdl.toml` (line width 160), `npm run lint:md` / `format:md` scripts, and lefthook
  pre-commit + pre-push hooks (rumdl, oxlint, oxfmt). All markdown is lint-clean.

## v0.6.0 - 2026-08-05

- **Onboarding**: "Set up connection…" welcome panel in the view when unconfigured; persistent status bar item showing
  connection state (click to connect / switch repo).
- **Agents support**: added AGENTS.md with repo conventions, RhodeCode API facts, and toolchain notes.

## v0.5.0 - 2026-08-05

- **Toolchain**: migrated from eslint to oxlint + oxfmt (configs `.oxlintrc.json`, `.oxfmtrc.json`).
- **README**: acknowledgments section crediting dimsedane's original vscode-rhodecode.
- Added `lint` / `format` / `format:check` scripts.

## v0.4.0 - 2026-08-05

- Connection wizard (Connect to RhodeCode…): format-validated server address, API key, live connection check, then a
  group/repo browser with type-to-filter and drill-down; repo saved to workspace settings.
- Branches and Tags sections in the view (from `get_repo_refs`), with open-changeset-in-browser.
- Server/repo discovery via `get_repo_groups` + `get_repos` (permission filtered).
- Tree view restructured into Pull Requests / Branches / Tags sections with a "Set up connection…" placeholder when
  unconfigured.

## v0.3.0 - 2026-08-05

- Task (TODO comment) support: read tasks from the server (`get_pull_request_comments` on RhodeCode 4.6+, HTML fallback
  on older servers), resolve tasks via `resolves_comment_id`, create tasks via `comment_type='todo'`.
- Approve and Merge warns when a pull request has open tasks before merging.
- Comment panel shows task badges, resolved state, and a task summary line.

## v0.2.0 - 2026-08-05

- Modernized toolchain: TypeScript 5, VS Code engine ^1.80, eslint, @vscode/vsce, axios 1.x.
- Added activity-bar Pull Requests view (status + review status icons).
- Added comment thread panel with reply and mark-handled/unhandled.
- Added local handled-state storage (`workspaceState`) with optional reply-comment toggle.

## v0.0.1 - 2018-04-24

- Initial fork of dimsedane/vscode-rhodecode.
