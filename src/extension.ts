import * as vscode from 'vscode';
import { RhodeCodeClient, reportError } from './rhodecode_request';
import { PullRequestTreeProvider } from './pull_request_tree_provider';
import { HandledStore } from './handled_store';
import { CommentViewProvider } from './comment_view_provider';
import { registerCommands } from './commands';
import { getServerUrlRaw, extractServerHostFromUrl } from './configuration';
import { getRepoIdRaw, getRepoLabel, getStoredRepo, initRepoState, setStoredRepo } from './repo_state';
import { getGitRemoteUrl, cloneUrisMatch, isRhodeCodeRemote, extractServerHost } from './git_remote';
import { watchForPushes } from './push_watcher';
import { RepoInfo } from './model/rhodecode';
import { PRStatusBar } from './pr_status_bar';
import { GitExtension } from './git_extension_api';

/** Debug output channel for the extension */
export let debugOutputChannel: vscode.OutputChannel | undefined;

/** Log level constants */
export enum LogLevel {
    DEBUG = 'debug',
    INFO = 'info',
    WARN = 'warn',
    ERROR = 'error',
}

/** Theme icons for log levels (emoji) */
const LOG_ICONS: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: '🪲',
    [LogLevel.INFO]: '📖',
    [LogLevel.WARN]: '⚠️',
    [LogLevel.ERROR]: '❌',
};

/**
 * Log a message to the debug output channel with a level.
 * Private to extension.ts - use logDebug/logWarn/logError for external access.
 */
function logToDebug(message: string, level: LogLevel = LogLevel.DEBUG): void {
    if (debugOutputChannel && vscode.workspace.getConfiguration('rhodecode').get<boolean>('debug', false)) {
        const icon = LOG_ICONS[level];
        const timestamp = new Date().toLocaleTimeString();
        const formattedMessage = `[${timestamp}] ${icon} [${level.toUpperCase()}] ${message}`;
        debugOutputChannel.appendLine(formattedMessage);
    }
}

/**
 * Log a DEBUG level message for tracking button clicks.
 */
export function logClick(message: string): void {
    logToDebug(message, LogLevel.DEBUG);
}

/**
 * Log a WARN level message when something fails or behaves unexpectedly.
 */
export function logWarn(message: string): void {
    logToDebug(message, LogLevel.WARN);
}

/**
 * Log an ERROR level message for critical failures.
 */
export function logError(message: string): void {
    logToDebug(message, LogLevel.ERROR);
}

/**
 * Log a DEBUG level message.
 * Alias for logClick for backwards compatibility.
 */
export function logDebug(message: string): void {
    logClick(message);
}

/**
 * Log a message to the debug output channel regardless of settings.
 * Use this for critical events like activation.
 */
export function logAlways(message: string): void {
    if (debugOutputChannel) {
        debugOutputChannel.appendLine(message);
    }
}

/**
 * Log a message to the debug output channel regardless of settings.
 * Alias for logAlways (for backwards compatibility).
 */
export const alwaysLog = logAlways;

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
    // Show just the host portion for cleaner display (issue #18)
    const host = extractServerHostFromUrl(server);
    item.text = `$(server) ${host ?? server}`;
    item.tooltip = `Connected to ${server}\nRepository: ${label ?? repo}\nClick to switch repository`;
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
        logDebug('autoDetectRepository: no workspace folder');
        return undefined;
    }
    const remote = await getGitRemoteUrl(folder.uri.fsPath);
    if (!remote) {
        logDebug('autoDetectRepository: no git remote found');
        return undefined;
    }
    logDebug(`autoDetectRepository: git remote URL = ${remote.url}`);
    const repos = await client.getRepos();
    logDebug(`autoDetectRepository: found ${repos.length} repos on server`);
    const match = repos.find((r) => cloneUrisMatch(r.clone_uri, remote.url));
    if (match) {
        logDebug(`autoDetectRepository: matched repo "${match.repo_name}"`);
        await setStoredRepo(match);
        return match;
    }
    logDebug('autoDetectRepository: no matching repo found');
    return undefined;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Create debug output channel
    debugOutputChannel = vscode.window.createOutputChannel('RhodeCode', 'rhodecode');
    context.subscriptions.push(debugOutputChannel);

    logAlways('=== RhodeCode Extension Activated ===');
    logAlways(`Version: ${context.extension.packageJSON.version}`);

    client = undefined;
    const store = new HandledStore(context.workspaceState);
    initRepoState(context.workspaceState);
    tree = new PullRequestTreeProvider(() => client, store);
    commentView = new CommentViewProvider(() => client, tree);
    prStatusBar = new PRStatusBar(() => client);

    const treeView = vscode.window.createTreeView('rhodecode.pullRequests', {
        treeDataProvider: tree,
        showCollapseAll: false,
    });
    context.subscriptions.push(treeView);
    context.subscriptions.push(prStatusBar);

    // Auto-load tree view when it becomes visible (issue #19)
    treeView.onDidChangeVisibility(async () => {
        if (treeView.visible) {
            await tree?.load();
        }
    });

    // Initial load when extension activates
    await tree?.load();

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
                logAlways('Configuration changed, rebuilding client...');
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

    // Listen for branch changes via Git extension API (auto-refresh PR/branch list).
    try {
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (gitExtension?.isActive) {
            const gitAPI = (gitExtension.exports as unknown as GitExtension).getAPI(1);
            // Listen for any repository state change (branch switch, commit, etc.)
            gitAPI.repositories.forEach((repo) => {
                context.subscriptions.push(
                    repo.state.onDidChange(async () => {
                        const newBranch = repo.state?.HEAD?.name;
                        if (newBranch) {
                            logDebug(`Branch change detected: ${newBranch}`);
                            logDebug('Starting PR/branch list refresh...');
                            await tree?.updateCurrentBranch();
                            await tree?.load();
                            logDebug('PR/branch list refresh complete');
                        }
                    }),
                );
            });
        } else {
            logDebug('Git extension not available, skipping branch change listener');
        }
    } catch (err) {
        logDebug(`Failed to set up Git extension listener: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Kick off an initial load so the view is populated when configured.
    void (async () => {
        try {
            logAlways('Starting initial load...');
            logAlways(`Server URL configured: ${getServerUrlRaw() ? 'yes' : 'no'}`);
            logAlways(`Repository selected: ${getRepoIdRaw() || 'no'}`);

            // Check for RhodeCode repo on initial activation
            await checkAndPromptForRhodeCode();

            logAlways('Attempting to create client...');
            client = await RhodeCodeClient.create();

            if (client) {
                logAlways(`Client created successfully for repo: ${client.getApiKey()}`);
            }

            // If no repo is selected yet, try git-remote auto-detection.
            // get_repos needs no repo id, so a fresh client suffices.
            if (!client && getServerUrlRaw() && !getStoredRepo()) {
                logAlways('No client yet, attempting detection mode...');
                const detectClient = await RhodeCodeClient.createForDetection();
                if (detectClient) {
                    logAlways('Detection client created successfully');
                    await autoDetectRepository(detectClient);
                    logAlways(`After detection: repo selected = ${getRepoIdRaw() || 'no'}`);
                } else {
                    logAlways('Detection client creation failed (no server URL or API key)');
                }
            }

            client = await RhodeCodeClient.create().catch(() => undefined);
            if (client && tree) {
                logAlways('Loading pull requests...');
                await tree.load();
                logAlways('Pull requests loaded successfully');
            }
        } catch (err) {
            logAlways(`Initial load error: ${err instanceof Error ? err.message : String(err)}`);
            reportError('load', err);
        }
        updateStatusBar(statusBar);
    })();
}

export function deactivate(): void {
    // nothing to clean up
}
