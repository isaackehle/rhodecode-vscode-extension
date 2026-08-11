# Change Log

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

## 0.8.7 - 2026-08-07

- Chore: add `bun run clean` script to remove build/test artifacts (`out/`, `.vscode-test/`, `.rumdl_cache/`,
  `*.vsix`). Uses `find -delete` instead of a `*.vsix` glob so it doesn't fail under shells (e.g. zsh) that error
  on an unmatched glob.

## 0.8.6 - 2026-08-07

- Test: fixed `scripts/test-configuration.cjs` — the `getApiKeyRaw returns undefined (no env file)` case read the
  real `~/.env` via `os.homedir()` without mocking it, so it failed on any machine (e.g. WSL) that has a real
  `RHODECODE_API_KEY` set up for the `apikeyFromEnv` feature. The test now stubs `os.homedir()` to a directory
  guaranteed to have no `.env`, making it hermetic regardless of the host machine.

## 0.8.5 - 2026-08-07

- Chore: `vscode:prepublish` now runs `bun run compile` instead of `npm run compile`, matching the rest of the
  toolchain (bun is the repo's preferred package manager).

## 0.8.4 - 2026-08-06

- Feat: Auto-detect RhodeCode workspaces. When opening a workspace, the extension now checks if the git remote is a
  RhodeCode repository (`/rhodecode/` or `:rhodecode/` pattern). If not connected, shows a notification:
  "Detected a RhodeCode repository. Connect now?" Clicking "Connect" pre-fills the server URL in the wizard.
- Test: Added `isRhodeCodeRemote()` and `extractServerHost()` helpers in `src/gitRemote.ts` with 26 unit tests covering
  https, ssh://, and scp-like URL formats.
- Test: Added generic test runner `scripts/run-tests.cjs` that auto-discovers all `test-*.cjs` and `test-*.ts` files in
  `scripts/`. No need to update `package.json` when adding new tests.
- Chore: Updated `@vscode/vsce` from 2.32.0 to 3.9.2 (latest) to eliminate deprecation warnings.
- Docs: Added `docs/auto-detect-workspace.md` design document describing the auto-detection workflow and integration test plan.

## 0.8.3 - 2026-08-06

- Test: add manifest consistency check (`activationEvents` vs `contributes.commands` vs
  `registerCommand`). Ensures every contributed command is registered in `commands.ts` and
  listed in `activationEvents` to prevent "command not found" errors on fresh installs.
- Test: add `scripts/test-manifest.cjs` — validates `activationEvents` includes all
  `rhodecode.*` commands and `contributes.commands` entries, and that each command is
  registered in `commands.ts`.

## 0.8.2 - 2026-08-06

- Test: add manifest consistency check (`activationEvents` vs `contributes.commands` vs
  `registerCommand`). Ensures every contributed command is registered in `commands.ts` and
  listed in `activationEvents` to prevent "command not found" errors on fresh installs.
- Test: add `scripts/test-manifest.cjs` — validates `activationEvents` includes all
  `rhodecode.*` commands and `contributes.commands` entries, and that each command is
  registered in `commands.ts`.
- Test: add `scripts/test-server-setup.cjs` — unit tests for `promptApiKey`, `promptGroup`,
  `promptRepository` with stubbed `window.showInputBox`/`showQuickPick`, covering retry
  logic, cancellation, and valid selections.
- Test: add `scripts/test-comment-view-provider.cjs` — unit tests for `CommentViewProvider`
  with stubbed `window.createWebviewPanel`, testing rejected/successful client calls for
  reply, resolve task, add task, and toggle handled.
- Test: add `scripts/test-select-repository.cjs` — unit tests for `selectRepository` command
  with stubbed `connect`, `browseRepos`, and `refreshAll`, covering success path,
  cancellation, and client rebuild.
- Test: add `@vscode/test-electron` integration harness (`src/test/`). `bun run
  test:integration` boots a real VS Code instance and runs 21 tests: extension activation,
  command registration, configuration schema defaults, and `apikeyFromEnv` setting behaviour
  end-to-end.
- Test: add `scripts/test-configuration.cjs` — 14 stub-based unit tests for
  `normalizeServerUrl`, `isApiKeyFromEnvEnabled`, and `getApiKeyRaw`. `bun run test` now
  runs 43 tests total.
- Feat: Add `rhodecode.apikeyFromEnv` setting.
  Reads `RHODECODE_API_KEY` from `.env` file (workspace first, then `~/.env`).
  Ignores `rhodecode.apikey` setting to prevent accidental commitment of API keys to repo `.vscode/settings`.
- Feat: When `apikeyFromEnv` is enabled and no env-file key is found, show a clear error message instead of falling back to the setting or prompting.
- Feat: Connect wizard detects env-file keys and allows keeping or overriding them for the session only (typed keys are not persisted to settings).
- Chore: Add `prepackage` script that runs tests before packaging to ensure releases only pass when all tests succeed.

## 0.8.1 - 2026-08-05

- Fix: all commands reported "command not found" on fresh installs. The packaged extension never shipped its runtime
  dependency (`axios` was excluded by `node_modules/**` in `.vscodeignore` + `--no-dependencies`), so activation threw
  `Cannot find module 'axios'` and no commands registered. Replaced axios with the built-in `fetch` (Node 18+ in
  VS Code 1.80); the extension now has zero runtime dependencies and the `.vsix` is self-contained (#5).
- Test: added `scripts/test-extension-load.cjs` — loads every compiled module through a `vscode` stub exactly like the
  extension host, guarding against missing-module regressions. `bun run test` now runs 15 env/remote cases + 13
  module-load cases.

## 0.8.0 - 2026-08-05

- Feat: repository is now auto-detected. The `rhodecode.repoid` setting is gone — on activation the extension reads
  `git config --get remote.origin.url`, matches it against the `clone_uri` of accessible repos (`get_repos`), and
  stores the matching repo (`repo_id` + metadata) in workspace state. Handles https, ssh://, and scp-like remotes
  (#4).
- Feat: API key can come from an environment file. `RHODECODE_API_KEY` is read from the workspace `.env` first, then
  `~/.env`, then falls back to the `rhodecode.apikey` setting (#2).
- Design: Settings UI shows proper display names (Server URL, API Key) instead of raw key casing (#3).

## 0.7.0 - 2026-08-05

- Feat: empty API key in the Connect wizard now shows a modal with the exact steps to create a RhodeCode auth token
  (user dropdown → My Account → Auth Tokens → Create), with a Retry button that reopens the prompt.
- Chore: bun is now the package manager (`bun install` → `bun.lock`); scripts and lefthook hooks run through bun/bunx.
- Docs: AGENTS.md documents the lockfile-commit rule and bun toolchain; README Development section updated.

## 0.6.2 - 2026-08-05

- Fix: extension icon. Added the top-level `icon` field (128x128 PNG) so the Extensions view shows the RhodeCode
  bubble instead of the default placeholder square. The activity-bar icon was a full-bleed SVG rect (rendered as a
  solid square when VS Code masks it monochrome) — replaced with a transparent-background bubble-only SVG.

## 0.6.1 - 2026-08-05

- Fix: extension now activates on fresh installs. `activationEvents` was an empty array, so no contributed command or
  view ever activated the extension ("command 'rhodecode.selectRepository' not found"). Now lists every contributed
  command plus `onView:rhodecode.pullRequests`.
- Markdown linting enabled: `.rumdl.toml` (line width 160), `npm run lint:md` / `format:md` scripts, and lefthook
  pre-commit + pre-push hooks (rumdl, oxlint, oxfmt). All markdown is lint-clean.

## 0.6.0 - 2026-08-05

- Onboarding: "Set up connection…" welcome panel in the view when unconfigured; persistent status bar item showing
  connection state (click to connect / switch repo).
- Agents support: added AGENTS.md with repo conventions, RhodeCode API facts, and toolchain notes.

## 0.5.0 - 2026-08-05

- Toolchain: migrated from eslint to oxlint + oxfmt (configs `.oxlintrc.json`, `.oxfmtrc.json`).
- README: acknowledgments section crediting dimsedane's original vscode-rhodecode.
- Added `lint` / `format` / `format:check` scripts.

## 0.4.0 - 2026-08-05

- Connection wizard (Connect to RhodeCode…): format-validated server address, API key, live connection check, then a
  group/repo browser with type-to-filter and drill-down; repo saved to workspace settings.
- Branches and Tags sections in the view (from `get_repo_refs`), with open-changeset-in-browser.
- Server/repo discovery via `get_repo_groups` + `get_repos` (permission filtered).
- Tree view restructured into Pull Requests / Branches / Tags sections with a "Set up connection…" placeholder when
  unconfigured.

## 0.3.0 - 2026-08-05

- Task (TODO comment) support: read tasks from the server (`get_pull_request_comments` on RhodeCode 4.6+, HTML fallback
  on older servers), resolve tasks via `resolves_comment_id`, create tasks via `comment_type='todo'`.
- Approve and Merge warns when a pull request has open tasks before merging.
- Comment panel shows task badges, resolved state, and a task summary line.

## 0.2.0 - 2026-08-05

- Modernized toolchain: TypeScript 5, VS Code engine ^1.80, eslint, @vscode/vsce, axios 1.x.
- Added activity-bar Pull Requests view (status + review status icons).
- Added comment thread panel with reply and mark-handled/unhandled.
- Added local handled-state storage (`workspaceState`) with optional reply-comment toggle.
