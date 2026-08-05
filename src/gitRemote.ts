import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Git remote detection (issue #4).
 *
 * Reads `git config --get remote.origin.url` in the workspace folder and
 * normalizes it so it can be matched against RhodeCode `get_repos` results
 * by `clone_uri`.
 */

export interface GitRemoteResult {
    url: string;
    path: string;
}

/**
 * Run `git config --get remote.origin.url` in the given directory.
 * Returns undefined when git is unavailable, the folder is not a repo,
 * or there is no origin remote.
 */
export async function getGitRemoteUrl(workspaceRoot: string): Promise<GitRemoteResult | undefined> {
    try {
        const { stdout } = await execFileAsync('git', ['config', '--get', 'remote.origin.url'], {
            cwd: workspaceRoot,
            timeout: 5000,
        });
        const url = stdout.trim();
        if (!url) {
            return undefined;
        }
        const path = normalizeRepoPath(url);
        if (!path) {
            return undefined;
        }
        return { url, path };
    } catch {
        return undefined;
    }
}

/**
 * Reduce a git remote URL to its repo path (owner/name, no scheme, host,
 * user, or .git suffix). Handles https, ssh://, and scp-like
 * (git@host:owner/repo.git) forms.
 */
export function normalizeRepoPath(url: string): string | undefined {
    let s = url.trim();
    if (!s) {
        return undefined;
    }
    // scheme://[user@]host/owner/repo.git
    const scheme = s.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/i);
    if (scheme) {
        s = scheme[2];
    } else {
        // scp-like: [user@]host:owner/repo.git
        const scp = s.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
        if (scp) {
            s = scp[2];
        }
    }
    s = s.replace(/\.git$/, '');
    s = s.replace(/\/+$/, '');
    s = s.replace(/^\/+/, '');
    return s || undefined;
}

/** Compare a RhodeCode clone_uri against a git remote URL by normalized path. */
export function cloneUrisMatch(cloneUri: string | null | undefined, gitRemoteUrl: string): boolean {
    if (!cloneUri) {
        return false;
    }
    const a = normalizeRepoPath(cloneUri);
    const b = normalizeRepoPath(gitRemoteUrl);
    return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
