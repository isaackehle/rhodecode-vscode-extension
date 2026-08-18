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
    branch?: string;
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
        const branch = await getCurrentBranch(workspaceRoot);
        return { url, path, branch };
    } catch {
        return undefined;
    }
}

/**
 * Get the current branch name using `git rev-parse --abbrev-ref HEAD`.
 * Returns undefined if not in a git repo or on a detached HEAD.
 */
export async function getCurrentBranch(workspaceRoot: string): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: workspaceRoot,
            timeout: 5000,
        });
        const branch = stdout.trim();
        return branch || undefined;
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

/**
 * Check if a git remote URL appears to be a RhodeCode repository.
 * Detects by looking for 'rhodecode' in the URL path.
 * Handles https, ssh://, and scp-like (git@host:...) forms.
 */
export function isRhodeCodeRemote(url: string): boolean {
    // Check for 'rhodecode' anywhere in the URL (host or path)
    // We want to match: host/rhodecode/repo, host:rhodecode/repo, etc.
    // But not: github.com/rhodecode-user/repo (where rhodecode is just a username)
    // Strategy: look for /rhodecode/ or :rhodecode/ pattern
    return /\/rhodecode\/|:rhodecode\//i.test(url);
}

/**
 * Extract the server host from a git remote URL.
 * Returns the host without protocol or user prefix.
 * Used to pre-fill server URL in the connect wizard.
 */
export function extractServerHost(url: string): string | undefined {
    let s = url.trim();
    if (!s) {
        return undefined;
    }
    // scheme://[user@]host/...
    const scheme = s.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/]+)/i);
    if (scheme) {
        return scheme[1];
    }
    // scp-like: [user@]host:owner/repo.git
    const scp = s.match(/^(?:[^@/]+@)?([^:/]+):/);
    if (scp) {
        return scp[1];
    }
    return undefined;
}
