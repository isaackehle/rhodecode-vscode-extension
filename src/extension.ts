import * as vscode from 'vscode';
import { RhodeCodeClient, reportError } from './rhodecoderequest';
import { PullRequestTreeProvider } from './pullRequestTreeProvider';
import { HandledStore } from './handledStore';
import { CommentViewProvider } from './commentViewProvider';
import { registerCommands } from './commands';
import { getServerUrlRaw } from './configuration';
import { getRepoIdRaw, getRepoLabel, getStoredRepo, initRepoState, setStoredRepo } from './repoState';
import { getGitRemoteUrl, cloneUrisMatch, isRhodeCodeRemote, extractServerHost } from './gitRemote';
import { watchForPushes } from './pushWatcher';
import { RepoInfo } from './model/rhodecode';

/** Branches that never get their own pull request, so the push tip is skipped for them. */
const DEFAULT_BRANCH_NAMES = new Set(['master', 'main', 'trunk']);

/**
 * After a branch is pushed (issue #6): if it already has an open pull
 * request, offer to open it; otherwise offer to create one. Skipped when
 * `rhodecode.pushTips` is disabled, the branch is a default branch, or
 * there's no active client (not connected / no repo selected).
 */
async function handleBranchPushed(branch: string): Promise<void> {
    if (!vscode.workspace.getConfiguration('rhodecode').get<boolean>('pushTips', true)) {
        return;
    }
    if (DEFAULT_BRANCH_NAMES.has(branch.toLowerCase())) {
        return;
    }
    if (!client) {
        return;
    }
    try {
        const openPullRequests = await client.getPullRequests();
        const existing = openPullRequests.find((pr) => pr.source.reference.name === branch);
        if (existing) {
            const choice = await vscode.window.showInformationMessage(
                `RhodeCode: Branch "${branch}" already has an open pull request (#${existing.pull_request_id}).`,
                'Open Pull Request',
            );
            if (choice === 'Open Pull Request') {
                await vscode.env.openExternal(vscode.Uri.parse(client.pullRequestUrl(existing.pull_request_id)));
            }
            return;
        }
        const choice = await vscode.window.showInformationMessage(
            `RhodeCode: Branch "${branch}" was pushed. Open a pull request?`,
            'Create Pull Request',
        );
        if (choice === 'Create Pull Request') {
            await vscode.commands.executeCommand('rhodecode.createPullRequest', branch);
        }
    } catch (err) {
        reportError('check pull requests for pushed branch', err);
    }
}
let client: RhodeCodeClient | undefined;
let tree: PullRequestTreeProvider | undefined;
let commentView: CommentViewProvider | undefined;

/** Persistent status bar entry: shows connection state, click to connect/switch repo. */
function updateStatusBar(item: vscode.StatusBarItem): void {
    const server = getServerUrlRaw();
    const repo = getRepoIdRaw();
    if (!server) {
        item.text = '$(plug) RhodeCode: not connected';
        item.tooltip = 'Click to set up your RhodeCode connection (server address + API key)';
        item.command = 'rhodecode.connect';
        item.show();
        return;
    }
    if (!repo) {
        item.text = '$(plug) RhodeCode: pick a repository';
        item.tooltip = `Connected to ${server} — click to select a repository`;
        item.command = 'rhodecode.selectRepository';
        item.show();
        return;
    }
    const label = getRepoLabel();
    item.text = '$(repo) RhodeCode: ' + repo;
    item.tooltip = `Connected to ${server}\nRepository: ${label ?? repo}\nClick to switch repository`;
    item.command = 'rhodecode.selectRepository';
    item.show();
}

/**
 * Check if the current workspace is a RhodeCode repository and trigger
 * the connect wizard if not already connected.
 */
async function checkAndPromptForRhodeCode(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return;
    }

    const remote = await getGitRemoteUrl(folder.uri.fsPath);
    if (!remote || !isRhodeCodeRemote(remote.url)) {
        return;
    }

    // Already connected? Skip prompt.
    if (getServerUrlRaw()) {
        return;
    }

    // Prompt user to connect
    const choice = await vscode.window.showInformationMessage(
        'Detected a RhodeCode repository. Connect now?',
        'Connect',
        'Later',
    );

    if (choice === 'Connect') {
        // Pre-fill the server URL from the detected remote
        const host = extractServerHost(remote.url);
        if (host) {
            await vscode.commands.executeCommand('rhodecode.connect', host);
        } else {
            await vscode.commands.executeCommand('rhodecode.connect');
        }
    }
}

/**
 * Auto-detect the repository for the current workspace (issue #4):
 * read `git config --get remote.origin.url`, fetch the repos the user can
 * access, and match on clone_uri. On success, persist the full RepoInfo
 * (repo_id + metadata) to workspace state.
 */
export async function autoDetectRepository(client: RhodeCodeClient): Promise<RepoInfo | undefined> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return undefined;
    }
    const remote = await getGitRemoteUrl(folder.uri.fsPath);
    if (!remote) {
        return undefined;
    }
    const repos = await client.getRepos();
    const match = repos.find((r) => cloneUrisMatch(r.clone_uri, remote.url));
    if (match) {
        await setStoredRepo(match);
        return match;
    }
    return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
    const store = new HandledStore(context.workspaceState);
    initRepoState(context.workspaceState);

    client = undefined;
    tree = new PullRequestTreeProvider(() => client, store);
    commentView = new CommentViewProvider(() => client, tree);

    const treeView = vscode.window.createTreeView('rhodecode.pullRequests', {
        treeDataProvider: tree,
        showCollapseAll: false,
    });
    context.subscriptions.push(treeView);

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(statusBar);

    const setClient = (c: RhodeCodeClient | undefined): void => {
        client = c;
    };

    const refreshAll = async (): Promise<void> => {
        updateStatusBar(statusBar);
        tree?.refresh();
        try {
            await tree?.load();
        } catch (err) {
            reportError('reload', err);
        }
    };

    registerCommands(context, () => client, tree, commentView, setClient, refreshAll);

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('rhodecode')) {
                // Rebuild from config so the wizard-persisted values take
                // effect even when this event fires after setClient().
                client = await RhodeCodeClient.create().catch(() => undefined);
                await refreshAll();
            }
        }),
    );

    // Listen for workspace folder changes to detect RhodeCode repos
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async () => {
            await checkAndPromptForRhodeCode();
        }),
    );

    // Offer to open/create a pull request whenever a branch is pushed (issue #6).
    context.subscriptions.push(watchForPushes((branch) => void handleBranchPushed(branch)));

    // Kick off an initial load so the view is populated when configured.
    void (async () => {
        try {
            // Check for RhodeCode repo on initial activation
            await checkAndPromptForRhodeCode();

            client = await RhodeCodeClient.create();
            // If no repo is selected yet, try git-remote auto-detection.
            // get_repos needs no repo id, so a fresh client suffices.
            if (!client && getServerUrlRaw() && !getStoredRepo()) {
                const detectClient = await RhodeCodeClient.createForDetection();
                if (detectClient) {
                    await autoDetectRepository(detectClient);
                }
            }
            client = await RhodeCodeClient.create().catch(() => undefined);
            if (client && tree) {
                await tree.load();
            }
        } catch (err) {
            reportError('load', err);
        }
        updateStatusBar(statusBar);
    })();
}

export function deactivate(): void {
    // nothing to clean up
}
