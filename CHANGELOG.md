# Change Log

## 0.8.2 - 2026-08-06

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
