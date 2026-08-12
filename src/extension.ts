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
import { PRStatusBar } from './prStatusBar';
import { execSync } from 'child_process';

/** Debug output channel for the extension */
export let debugOutputChannel: vscode.OutputChannel | undefined;

/**
 * Log a message to the debug output channel if debug logging is enabled.
 * This is useful for troubleshooting connection issues, API calls, etc.
 */
export function debugLog(message: string): void {
    if (debugOutputChannel && vscode.workspace.getConfiguration('rhodecode').get<boolean>('debug', false)) {
        debugOutputChannel.appendLine(message);
    }
}

/**
 * Log a message to the debug output channel regardless of settings.
 * Use this for critical events like activation.
 */
export function alwaysLog(message: string): void {
    if (debugOutputChannel) {
        debugOutputChannel.appendLine(message);
    }
}

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
let prStatusBar: PRStatusBar | undefined;

/** Persistent status bar entry: shows connection state, click to connect/switch repo. */
function updateStatusBar(item: vscode.StatusBarItem): void {
    const server = getServerUrlRaw();
    const repo = getRepoIdRaw();
    if (!server) {
        item.text = '$(plug) RhodeCode: not connected';
        item.tooltip =
            'Click to set up your RhodeCode connection (server address + API key)\nOr open the View → Output → RhodeCode to see debug logs';
        item.command = 'rhodecode.connect';
        item.show();
        return;
    }
    if (!repo) {
        item.text = '$(repo) RhodeCode: select repository';
        item.tooltip = `Connected to ${server}\nClick to select a repository from your server\nOr open View → Output → RhodeCode to see debug logs`;
        item.command = 'rhodecode.selectRepository';
        item.show();
        return;
    }
    const label = getRepoLabel();
    // Get the git remote URL for display
    const folder = vscode.workspace.workspaceFolders?.[0];
    let remoteUrl = '';
    if (folder) {
        try {
            remoteUrl = execSync(`git --git-dir="${folder.uri.fsPath}/.git" config --get remote.origin.url`, {
                encoding: 'utf8',
            }).trim();
        } catch {
            // Ignore errors getting remote URL
        }
    }
    // Show remote URL in status bar if available, otherwise show repo name
    const displayText = remoteUrl ? `$(repo) ${remoteUrl}` : `$(repo) RhodeCode: ${repo}`;
    item.text = displayText;
    item.tooltip = `Connected to ${server}\nRepository: ${label ?? repo}\nRemote: ${remoteUrl || 'N/A'}\nClick to switch repository`;
    item.command = 'rhodecode.selectRepository';
    item.show();
}

/**
 * Check if the current workspace is a RhodeCode repository and trigger
 * the connect wizard if not already connected, or auto-detect the repo
 * if connected but no repo is selected (issue #15).
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

    // Already connected and repo selected? Skip.
    if (getServerUrlRaw() && getStoredRepo()) {
        return;
    }

    // Not connected yet - prompt to connect
    if (!getServerUrlRaw()) {
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
        return;
    }

    // Connected but no repo selected - auto-detect (issue #15)
    try {
        const detectClient = await RhodeCodeClient.createForDetection();
        if (detectClient) {
            const match = await autoDetectRepository(detectClient);
            if (match) {
                // Auto-select the detected repository
                vscode.window.showInformationMessage(`Auto-detected RhodeCode repository "${match.repo_name}"`);
            }
        }
    } catch (err) {
        reportError('auto-detect repository', err);
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
    // Create debug output channel
    debugOutputChannel = vscode.window.createOutputChannel('RhodeCode', 'rhodecode');
    context.subscriptions.push(debugOutputChannel);

    alwaysLog('=== RhodeCode Extension Activated ===');
    alwaysLog(`Version: ${context.extension.packageJSON.version}`);

    const store = new HandledStore(context.workspaceState);
    initRepoState(context.workspaceState);

    client = undefined;
    tree = new PullRequestTreeProvider(() => client, store);
    commentView = new CommentViewProvider(() => client, tree);
    prStatusBar = new PRStatusBar(() => client);

    const treeView = vscode.window.createTreeView('rhodecode.pullRequests', {
        treeDataProvider: tree,
        showCollapseAll: false,
    });
    context.subscriptions.push(treeView);
    context.subscriptions.push(prStatusBar);

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(statusBar);

    const setClient = (c: RhodeCodeClient | undefined): void => {
        client = c;
    };

    const refreshAll = async (): Promise<void> => {
        updateStatusBar(statusBar);
        prStatusBar?.update();
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
                alwaysLog('Configuration changed, rebuilding client...');
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
            alwaysLog('Starting initial load...');
            alwaysLog(`Server URL configured: ${getServerUrlRaw() ? 'yes' : 'no'}`);
            alwaysLog(`Repository selected: ${getRepoIdRaw() || 'no'}`);

            // Check for RhodeCode repo on initial activation
            await checkAndPromptForRhodeCode();

            alwaysLog('Attempting to create client...');
            client = await RhodeCodeClient.create();

            if (client) {
                alwaysLog(`Client created successfully for repo: ${client.getApiKey()}`);
            }

            // If no repo is selected yet, try git-remote auto-detection.
            // get_repos needs no repo id, so a fresh client suffices.
            if (!client && getServerUrlRaw() && !getStoredRepo()) {
                alwaysLog('No client yet, attempting detection mode...');
                const detectClient = await RhodeCodeClient.createForDetection();
                if (detectClient) {
                    await autoDetectRepository(detectClient);
                }
            }

            client = await RhodeCodeClient.create().catch(() => undefined);
            if (client && tree) {
                alwaysLog('Loading pull requests...');
                await tree.load();
                alwaysLog('Pull requests loaded successfully');
            }
        } catch (err) {
            alwaysLog(`Initial load error: ${err instanceof Error ? err.message : String(err)}`);
            reportError('load', err);
        }
        updateStatusBar(statusBar);
    })();
}

export function deactivate(): void {
    // nothing to clean up
}
