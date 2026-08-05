# RhodeCode VS Code Extension — Agent Instructions

This file is the canonical behavior reference for any AI coding agent (Hermes, Claude Code, Codex, OpenCode, Cline, Copilot)
working in this repo.

## What This Is

A VS Code extension for [RhodeCode](https://rhodecode.com/) pull request workflows. It talks to a RhodeCode server via its
JSON-RPC API (`POST {server}/_admin/api`) and renders PRs, comments, and branches in VS Code views.

**Do not treat this as a generic "extension" task.** The server API has real quirks (see `src/rhodecoderequest.ts` and the
vscode-extension-development skill references). Read the code before editing.

## Repository Layout

```text
src/rhodecoderequest.ts      API client: JSON-RPC over axios; all server calls go through here
src/model/rhodecode.ts       Domain types (PRs, comments, tasks, refs, groups, repos)
src/configuration.ts         Settings accessors + URL validation (normalizeServerUrl)
src/serverSetup.ts           Connection wizard: URL → API key → verify → group/repo browser
src/pullRequestTreeProvider.ts  Activity-bar tree (PRs / Branches / Tags sections)
src/commentViewProvider.ts   Webview comment thread (tasks, reply, mark handled)
src/commentParser.ts         HTML fallback parser for RhodeCode < 4.6
src/handledStore.ts          Local "handled" state (workspaceState)
src/commands.ts              Command registrations + merge gate
src/extension.ts             Activation entry point
media/rhodecode-icon.png     128x128 extension icon (top-level `icon` field in package.json)
media/rhodecode-icon.svg     activity-bar icon (must be transparent-bg monochrome; VS Code masks it)
```

## Toolchain

- TypeScript 5, VS Code engine `^1.80`, target ES2022
- **oxlint** for linting, **oxfmt** for formatting (NOT eslint/prettier)
- `@vscode/vsce` for packaging

```shell
bun install
bun run compile      # tsc -> out/
bun run lint         # oxlint src
bun run format       # oxfmt --write src
bun run package      # vsce package -> .vsix
```

- bun is the package manager (lockfile: `bun.lock`); `npm run ...` works too — scripts are identical.
- `.oxlintrc.json` — lint rules (unused-vars / no-explicit-any are warnings)
- `.oxfmtrc.json` — 4-space indent, single quotes, print width 120, semicolons, trailing commas — **preserve this style**
- Run `bun run format` after edits; the tree must stay `bun run format:check`-clean
- README.md / CHANGELOG.md must stay markdown-lint clean

## API Facts (verified against RhodeCode source)

- Endpoint: `POST {serverUrl}/_admin/api`, JSON-RPC payload `{id, method, params, apikey}`
- Web pages accept `?api_key=...` for authenticated HTML fetches
- **No native "list repos" endpoint** — use `get_repo_groups()` + `get_repos(root=null, traverse=true)` (permission-filtered server-side)
- Refs: `get_repo_refs(repoid)` → `{branches, tags, bookmarks, branches_closed}` maps of name → sha
- Tasks: `get_pull_request_comments(pullrequestid)` returns `comment_type: 'todo'|'note'` and `comment_resolved_by` (null = open task)
- Resolve a task = post a comment with `resolves_comment_id=<task comment id>`
- Create a task = `comment_pull_request(..., comment_type='todo')`
- Merge is blocked server-side while open tasks exist — the extension mirrors that gate in `approveAndMerge`
- Older servers (<4.6): fall back to parsing PR page HTML (see `src/commentParser.ts`)

## Conventions

- Settings: `rhodecode.serverurl` / `rhodecode.apikey` (global), `rhodecode.repoid` (workspace). Users normally configure via the Connect wizard, not raw settings.
- The connect wizard persists serverUrl + apiKey + repoid **atomically at the end** — never write partial config.
- The client is rebuilt after repo selection so `repoId` matches the picked repo.
- Commands: prefix `rhodecode.`; register in BOTH `package.json` contributions and `src/commands.ts`.
- No `Co-Authored-By` trailers. Conventional Commits, subject ≤ 72 chars: `feat(comments): ...`, `fix(api): ...`, `chore(toolchain): ...`.
- Commit the lockfile whenever dependencies change (`bun install` updates `bun.lock`) — a stale lockfile silently pins
  old versions for everyone who installs later.

## Versioning & Releases

- Every release gets an annotated git tag `v<version>` on the commit that bumps `package.json` version, plus a GitHub
  Release with the `.vsix` attached.
- When you bump the version, tag it in the same step:

  ```shell
  git tag -a v0.7.0 -m "v0.7.0: <one-line summary>"
  git push origin master --tags
  ```

- The GitHub Release body is the CHANGELOG entry for that version; attach the packaged `.vsix` (`bun run package`).
- Keep one tag per version bump commit, pointing at the exact commit where the version changed (use `git log` +
  `git show <sha>:package.json` to find it, not just the latest commit).

## Verify Before Finishing

```shell
bun run lint && bun run lint:md && bun run format:check && bun run compile && bun run package
```

- `bun run lint:md` runs `rumdl check .` — markdown must stay clean (`.rumdl.toml`, line width 160).
- The view shows a viewsWelcome "Set up connection…" panel when unconfigured — don't break the onboarding path.
- `activationEvents` in `package.json` must list EVERY contributed command (`onCommand:rhodecode.*`) plus
  `onView:rhodecode.pullRequests`. An empty `[]` means the extension never activates on fresh installs and every command
  fails with "command not found".
- `package.json` needs a top-level `icon` field pointing at a 128x128 PNG (`media/rhodecode-icon.png`); the activity-bar
  SVG (`media/rhodecode-icon.svg`) must have a transparent background and a single fill — VS Code masks it monochrome, so
  a full-bleed `<rect>` renders as a solid square.
- After packaging, optionally `code --install-extension <file>.vsix --force` and confirm it lists.
