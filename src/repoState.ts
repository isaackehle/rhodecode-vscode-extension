import * as vscode from 'vscode';
import { RepoInfo } from './model/rhodecode';

/**
 * Detected repository state (issue #4).
 *
 * The selected repo is no longer stored in the `rhodecode.repoid` setting.
 * Instead it lives in VS Code workspace state, populated either by
 * git-remote auto-detection on activation or by the repository picker.
 */
const REPO_STATE_KEY = 'rhodecode.repoInfo';

let workspaceState: vscode.Memento | undefined;

/** Wire the store to the extension's workspaceState (call once in activate). */
export function initRepoState(state: vscode.Memento): void {
    workspaceState = state;
}

/** Full RepoInfo currently selected (repo_id, repo_name, clone_uri, ...). */
export function getStoredRepo(): RepoInfo | undefined {
    return workspaceState?.get<RepoInfo>(REPO_STATE_KEY);
}

/** Persist the selected repo (repo_id + metadata) to workspace state. */
export async function setStoredRepo(repo: RepoInfo): Promise<void> {
    await workspaceState?.update(REPO_STATE_KEY, repo);
}

/** repo_name — the path RhodeCode uses in URLs and API calls (e.g. team/services/api). */
export function getRepoIdRaw(): string | undefined {
    return getStoredRepo()?.repo_name;
}

/** Numeric repo_id from RhodeCode, if known (metadata display). */
export function getRepoIdNumber(): number | undefined {
    return getStoredRepo()?.repo_id;
}

/** Human-readable one-liner for the status bar / settings display. */
export function getRepoLabel(): string | undefined {
    const repo = getStoredRepo();
    if (!repo) {
        return undefined;
    }
    const parts = [repo.repo_name];
    if (repo.repo_type) {
        parts.push(repo.repo_type);
    }
    if (repo.clone_uri) {
        parts.push(repo.clone_uri);
    }
    return parts.join(' — ');
}
