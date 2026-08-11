import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseDotEnv } from './dotenvParser';

/**
 * API key resolution (issue #2):
 *   1. `RHODECODE_API_KEY` in the workspace `.env` file (project directory)
 *   2. `RHODECODE_API_KEY` in `~/.env` (user home directory)
 *   3. fall back to the `rhodecode.apikey` setting
 *
 * Project `.env` is expected to be gitignored; `~/.env` never is.
 */

const ENV_KEY = 'RHODECODE_API_KEY';

/** Read and parse a .env file at the given directory, or undefined if absent. */
function readEnvFile(dir: string): Record<string, string> | undefined {
    const file = path.join(dir, '.env');
    try {
        // Check if file exists before reading (avoids Windows permission issues)
        if (!fs.existsSync(file)) {
            return undefined;
        }
        return parseDotEnv(fs.readFileSync(file, 'utf8'));
    } catch {
        // Silently ignore permission errors, file not found, etc.
        return undefined;
    }
}

/** First workspace folder root, if any. */
function workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Look up RHODECODE_API_KEY with the documented precedence:
 * workspace `.env`, then `~/.env`. Returns undefined if neither file has it.
 */
export function getApiKeyFromEnv(): string | undefined {
    const root = workspaceRoot();
    const candidates: string[] = [];
    if (root) {
        candidates.push(root);
    }
    candidates.push(os.homedir());

    for (const dir of candidates) {
        const env = readEnvFile(dir);
        const key = env?.[ENV_KEY]?.trim();
        if (key) {
            return key;
        }
    }
    return undefined;
}
