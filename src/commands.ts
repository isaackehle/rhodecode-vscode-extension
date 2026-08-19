import * as vscode from 'vscode';
import { RhodeCodeClient, reportError } from './rhodecode_request';
import { RhodeCodePullRequest } from './model/rhodecode';
import { PullRequestItem, PullRequestTreeProvider, GroupItem, RepoItem } from './pull_request_tree_provider';
import { CommentViewProvider } from './comment_view_provider';
import { setupConnection, browseRepositories } from './server_setup';
import { setApiKey, setServerUrl, isApiKeyFromEnvEnabled } from './configuration';
import { setStoredRepo } from './repo_state';
import { getCurrentBranch } from './git_remote';
import { RepoBrowserPanel } from './repo_browser_panel';
import { debugOutputChannel, debugClick, warn, error } from './extension';

export function registerCommands(
    context: vscode.ExtensionContext,
    getClient: () => RhodeCodeClient | undefined,
    tree: PullRequestTreeProvider,
    commentView: CommentViewProvider,
    setClient: (client: RhodeCodeClient | undefined) => void,
    refreshAll: () => Promise<void>,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('rhodecode.connect', async (prefillServer?: string) => {
            debugClick('Button clicked: rhodecode.connect');
            try {
                const result = await setupConnection(prefillServer);
                if (!result) {
                    warn('Connection cancelled by user');
                    return;
                }
                // Persist all settings at once so a cancelled wizard never
                // leaves partial configuration behind. With apikeyFromEnv the
                // apikey setting is disabled, so the key stays out of settings.
                await setServerUrl(result.serverUrl);
                if (!isApiKeyFromEnvEnabled()) {
                    await setApiKey(result.apiKey);
                }
                await setStoredRepo(result.repo);
                setClient(result.client);
                vscode.window.showInformationMessage(
                    `Connected to ${result.serverUrl} — repository "${result.repo.repo_name}" selected.`,
                );
                debugClick('Connection successful');
                await refreshAll();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                error(`Connection failed: ${message}`);
                reportError('connect', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.openDebugOutput', async () => {
            debugClick('Button clicked: rhodecode.openDebugOutput');
            if (debugOutputChannel) {
                debugOutputChannel.show(true);
                debugClick('Debug output channel opened');
            } else {
                warn('Debug output channel not available');
                vscode.window.showInformationMessage('RhodeCode debug output channel not available yet.');
            }
        }),

        vscode.commands.registerCommand('rhodecode.selectRepository', async () => {
            debugClick('Button clicked: rhodecode.selectRepository');
            const initialClient = getClient();
            if (!initialClient) {
                debugClick('No client, initiating connect flow');
                await vscode.commands.executeCommand('rhodecode.connect');
            }
            // rhodecode.connect reports its own errors and calls setClient() on
            // success; re-check so a successful connect flows straight into repo
            // selection instead of forcing the user to invoke this command twice.
            const client = initialClient ?? getClient();
            if (!client) {
                warn('No client available for repository selection');
                return;
            }
            try {
                debugClick('Opening repository browser');
                const repo = await browseRepositories(client);
                if (!repo) {
                    warn('Repository selection cancelled by user');
                    return;
                }
                await setStoredRepo(repo);
                // Rebuild the client so it points at the newly chosen repo.
                setClient(new RhodeCodeClient(client.getServerUrl(), client.getApiKey(), repo.repo_name));
                debugClick(`Repository selected: ${repo.repo_name}`);
                await refreshAll();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                error(`Failed to select repository: ${message}`);
                reportError('select repository', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.toggleGroup', async (item: GroupItem) => {
            debugClick(`Button clicked: rhodecode.toggleGroup on group "${item.group.group_name}"`);
            if (!tree) {
                warn('Tree provider not available for toggleGroup');
                return;
            }
            tree.toggleGroupSelection(item.group.group_id);
            debugClick(`Group "${item.group.group_name}" toggled`);
        }),

        vscode.commands.registerCommand('rhodecode.selectRepoFromTree', async (item: RepoItem) => {
            debugClick(`Button clicked: rhodecode.selectRepoFromTree on "${item.repo.repo_name}"`);
            if (!tree) {
                warn('Tree provider not available for selectRepoFromTree');
                return;
            }
            try {
                const client = getClient();
                if (!client) {
                    warn('No client available for repository selection from tree');
                    return;
                }
                await setStoredRepo(item.repo);
                // Rebuild the client so it points at the newly chosen repo.
                setClient(new RhodeCodeClient(client.getServerUrl(), client.getApiKey(), item.repo.repo_name));
                debugClick(`Repository selected from tree: ${item.repo.repo_name}`);
                await refreshAll();
                vscode.window.showInformationMessage(`Selected repository "${item.repo.repo_name}"`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                error(`Failed to select repository from tree: ${message}`);
                reportError('select repo from tree', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.openChangeset', async (sha?: string) => {
            debugClick(`Button clicked: rhodecode.openChangeset for commit ${sha?.slice(0, 8) || 'unknown'}`);
            const client = getClient();
            if (!client) {
                warn('No client available for opening changeset');
                return;
            }
            if (!sha) {
                warn('No commit SHA provided for opening changeset');
                return;
            }
            try {
                const url = client.changesetUrl(sha);
                await vscode.env.openExternal(vscode.Uri.parse(url));
                debugClick(`Opened changeset in browser: ${url}`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                error(`Failed to open changeset: ${message}`);
            }
        }),

        vscode.commands.registerCommand('rhodecode.switchBranch', async (item?: vscode.TreeItem) => {
            debugClick('Button clicked: rhodecode.switchBranch');
            const client = getClient();
            if (!client) {
                warn('No client available for switching branch');
                return;
            }
            // Extract branch name from the item label
            const branchName = item?.label as string | undefined;
            if (!branchName) {
                warn('No branch name found in tree item');
                vscode.window.showErrorMessage('No branch name found.');
                return;
            }
            try {
                debugClick(`Switching to branch: ${branchName}`);
                // Use git command to checkout the branch
                const { exec } = await import('child_process');
                const { promisify } = await import('util');
                const execAsync = promisify(exec);
                const folder = vscode.workspace.workspaceFolders?.[0];
                if (!folder) {
                    warn('No workspace folder found for git checkout');
                    vscode.window.showErrorMessage('No workspace folder found.');
                    return;
                }
                await execAsync(`git checkout ${branchName}`, { cwd: folder.uri.fsPath });
                debugClick(`Successfully switched to branch: ${branchName}`);
                await tree.updateCurrentBranch();
                debugClick('Updated current branch in tree view');
                vscode.window.showInformationMessage(`Switched to branch "${branchName}"`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                error(`Failed to switch to branch ${branchName}: ${message}`);
                vscode.window.showErrorMessage(`Failed to switch to branch "${branchName}": ${message}`);
            }
        }),

        vscode.commands.registerCommand('rhodecode.switchTag', async (item?: vscode.TreeItem) => {
            debugClick('Button clicked: rhodecode.switchTag');
            const client = getClient();
            if (!client) {
                warn('No client available for switching tag');
                return;
            }
            // Extract tag name from the item label
            const tagName = item?.label as string | undefined;
            if (!tagName) {
                warn('No tag name found in tree item');
                vscode.window.showErrorMessage('No tag name found.');
                return;
            }
            try {
                debugClick(`Switching to tag: ${tagName}`);
                // Use git command to checkout the tag
                const { exec } = await import('child_process');
                const { promisify } = await import('util');
                const execAsync = promisify(exec);
                const folder = vscode.workspace.workspaceFolders?.[0];
                if (!folder) {
                    warn('No workspace folder found for git checkout');
                    vscode.window.showErrorMessage('No workspace folder found.');
                    return;
                }
                await execAsync(`git checkout ${tagName}`, { cwd: folder.uri.fsPath });
                debugClick(`Successfully switched to tag: ${tagName}`);
                await tree.updateCurrentBranch();
                debugClick('Updated current branch in tree view');
                vscode.window.showInformationMessage(`Switched to tag "${tagName}"`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                error(`Failed to switch to tag ${tagName}: ${message}`);
                vscode.window.showErrorMessage(`Failed to switch to tag "${tagName}": ${message}`);
            }
        }),

        vscode.commands.registerCommand('rhodecode.refresh', async () => {
            debugClick('Button clicked: rhodecode.refresh');
            const client = getClient();
            if (!client) {
                warn('No client available for refresh');
                return;
            }
            try {
                debugClick('Loading tree data');
                await tree.load();
                debugClick('Refresh completed successfully');
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                error(`Refresh failed: ${message}`);
                reportError('refresh', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.showPullRequests', async () => {
            debugClick('Button clicked: rhodecode.showPullRequests');
            const client = getClient();
            if (!client) {
                warn('No client available for showing pull requests');
                return;
            }
            try {
                debugClick('Fetching pull requests from server');
                const prs = await client.getPullRequests();
                if (prs.length === 0) {
                    warn('No open pull requests found on server');
                    vscode.window.showInformationMessage('No open pull requests found.');
                    return;
                }
                debugClick(`Found ${prs.length} pull requests, showing quick pick`);
                const picked = await vscode.window.showQuickPick(
                    prs.map((pr) => ({
                        label: `#${pr.pull_request_id} ${pr.title}`,
                        description: `${pr.status} · ${pr.review_status}`,
                        detail: (pr.description || '').slice(0, 200),
                        pr,
                    })),
                    { placeHolder: 'Select a pull request' },
                );
                if (picked) {
                    debugClick(`Selected pull request #${picked.pr.pull_request_id}`);
                    await commentView.show(picked.pr);
                } else {
                    warn('Pull request selection cancelled by user');
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                error(`Failed to load pull requests: ${message}`);
                reportError('load pull requests', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.showComments', async (item?: PullRequestItem) => {
            debugClick('Button clicked: rhodecode.showComments');
            const client = getClient();
            if (!client) {
                warn('No client available for showing comments');
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                warn('No pull request selected for showing comments');
                return;
            }
            try {
                debugClick(`Showing comments for PR #${pr.pull_request_id}`);
                await commentView.show(pr);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                error(`Failed to show comments for PR #${pr.pull_request_id}: ${message}`);
                reportError('show comments', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.replyComment', async (item?: PullRequestItem) => {
            debugClick('Button clicked: rhodecode.replyComment');
            const client = getClient();
            if (!client) {
                warn('No client available for replying to comments');
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                warn('No pull request selected for replying');
                return;
            }
            debugClick(`Opening reply input for PR #${pr.pull_request_id}`);
            const text = await vscode.window.showInputBox({
                prompt: 'Reply on pull request #' + pr.pull_request_id,
                placeHolder: 'Your reply',
            });
            if (!text) {
                warn('Reply cancelled by user');
                return;
            }
            try {
                debugClick(`Posting reply to PR #${pr.pull_request_id}`);
                await client.commentOnPullRequest(pr.pull_request_id, text);
                await tree.invalidateComments(pr);
                debugClick('Reply posted successfully');
                vscode.window.showInformationMessage('Reply posted.');
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                error(`Failed to post reply to PR #${pr.pull_request_id}: ${message}`);
                reportError('reply', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.markHandled', async (item?: PullRequestItem) => {
            debugClick('Button clicked: rhodecode.markHandled');
            const client = getClient();
            if (!client) {
                warn('No client available for marking as handled');
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                warn('No pull request selected for marking handled');
                return;
            }
            debugClick(`Marking comments as handled for PR #${pr.pull_request_id}`);
            await commentView.show(pr);
        }),

        vscode.commands.registerCommand('rhodecode.markUnhandled', async (item?: PullRequestItem) => {
            debugClick('Button clicked: rhodecode.markUnhandled');
            const client = getClient();
            if (!client) {
                warn('No client available for marking as unhandled');
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                warn('No pull request selected for marking unhandled');
                return;
            }
            debugClick(`Marking comments as unhandled for PR #${pr.pull_request_id}`);
            await commentView.show(pr);
        }),

        vscode.commands.registerCommand('rhodecode.openPullRequest', async (item?: PullRequestItem) => {
            debugClick('Button clicked: rhodecode.openPullRequest');
            const client = getClient();
            if (!client) {
                warn('No client available for opening pull request');
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                warn('No pull request selected for opening');
                return;
            }
            try {
                const url = client.pullRequestUrl(pr.pull_request_id);
                debugClick(`Opening pull request #${pr.pull_request_id} in browser: ${url}`);
                await vscode.env.openExternal(vscode.Uri.parse(url));
                debugClick(`Pull request #${pr.pull_request_id} opened in browser`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                error(`Failed to open pull request #${pr.pull_request_id}: ${message}`);
            }
        }),

        vscode.commands.registerCommand('rhodecode.approveAndMerge', async (item?: PullRequestItem) => {
            debugClick('Button clicked: rhodecode.approveAndMerge');
            const client = getClient();
            if (!client) {
                warn('No client available for approve and merge');
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                warn('No pull request selected for approve and merge');
                return;
            }
            debugClick(`Preparing to approve and merge PR #${pr.pull_request_id}`);

            // Check for open tasks (TODO comments): RhodeCode blocks merging
            // while tasks are unresolved, so warn before attempting.
            const openTasks = await countOpenTasks(client, pr);
            if (openTasks > 0) {
                debugClick(`Found ${openTasks} open task${openTasks > 1 ? 's' : ''} on PR #${pr.pull_request_id}`);
                const proceed = await vscode.window.showQuickPick(['No', 'Yes'], {
                    ignoreFocusOut: true,
                    placeHolder: `#${pr.pull_request_id} has ${openTasks} open task${openTasks > 1 ? 's' : ''}. Resolve them in the comments view first. Merge anyway?`,
                });
                if (proceed !== 'Yes') {
                    warn(`User declined to merge PR #${pr.pull_request_id} with open tasks`);
                    return;
                }
            }

            const answer = await vscode.window.showQuickPick(['Yes', 'No'], {
                ignoreFocusOut: true,
                placeHolder: `Approve and merge #${pr.pull_request_id}?`,
            });
            if (answer !== 'Yes') {
                warn(`User declined to approve and merge PR #${pr.pull_request_id}`);
                return;
            }
            debugClick(`User confirmed approve and merge for PR #${pr.pull_request_id}`);
            await vscode.window.withProgress(
                {
                    title: 'Merging pull request',
                    location: vscode.ProgressLocation.Notification,
                },
                async (progress) => {
                    try {
                        if (pr.review_status !== 'approved') {
                            progress.report({ message: 'Approving…' });
                            debugClick(`Approving PR #${pr.pull_request_id}`);
                            await client.approvePullRequest(pr.pull_request_id);
                            debugClick(`PR #${pr.pull_request_id} approved`);
                        }
                        progress.report({ message: 'Merging…' });
                        debugClick(`Merging PR #${pr.pull_request_id}`);
                        await client.mergePullRequest(pr.pull_request_id);
                        debugClick(`PR #${pr.pull_request_id} merged successfully`);
                        vscode.window.showInformationMessage('Successfully merged the pull request.');
                        await tree.load();
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        error(`Failed to approve/merge PR #${pr.pull_request_id}: ${message}`);
                        reportError('approve/merge', err);
                    }
                },
            );
        }),

        vscode.commands.registerCommand('rhodecode.addMessage', async () => {
            debugClick('Button clicked: rhodecode.addMessage');
            const client = getClient();
            if (!client) {
                warn('No client available for adding message');
                return;
            }
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                warn('No active editor for adding message');
                vscode.window.showInformationMessage(
                    'No active editor. Open a file from the pull request to add a message.',
                );
                return;
            }
            const pr = await pickPullRequest(client);
            if (!pr) {
                warn('No pull request selected for adding message');
                return;
            }
            const line = editor.selection.active.line + 1;
            const filePath = editor.document.fileName;
            debugClick(`Adding message to line ${line} in ${filePath} on PR #${pr.pull_request_id}`);
            const message = await vscode.window.showInputBox({
                prompt: `Add a message to line ${line} in ${filePath} on PR #${pr.pull_request_id}`,
                placeHolder: 'Your message',
            });
            if (!message) {
                warn('Message input cancelled by user');
                return;
            }
            try {
                // Use commentOnPullRequest with line number info in the message
                const fullMessage = `@line:${line} ${message}`;
                debugClick(`Posting message to PR #${pr.pull_request_id}`);
                await client.commentOnPullRequest(pr.pull_request_id, fullMessage);
                await tree.invalidateComments(pr);
                debugClick('Message added successfully');
                vscode.window.showInformationMessage('Message added.');
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                error(`Failed to add message to PR #${pr.pull_request_id}: ${message}`);
                reportError('add message', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.createPullRequest', async (prefillSourceBranch?: string) => {
            debugClick('Button clicked: rhodecode.createPullRequest');
            const client = getClient();
            if (!client) {
                warn('No client available for creating pull request');
                return;
            }
            try {
                debugClick('Prompting for source branch name');
                const sourceBranch = await vscode.window.showInputBox({
                    placeHolder: 'Source branch name',
                    prompt: 'Please enter the branch name of the source branch',
                    value: prefillSourceBranch,
                });
                if (!sourceBranch) {
                    warn('Source branch input cancelled by user');
                    return;
                }
                debugClick(`Source branch: ${sourceBranch}, prompting for target branch`);
                const targetBranch = await vscode.window.showInputBox({
                    placeHolder: 'Target branch name',
                    prompt: 'Please enter the branch name of the target branch',
                    value: 'master',
                });
                if (!targetBranch) {
                    warn('Target branch input cancelled by user');
                    return;
                }
                debugClick(`Target branch: ${targetBranch}, prompting for PR name`);
                const name = await vscode.window.showInputBox({
                    placeHolder: 'Pull request name',
                    prompt: 'Please enter a name for your pull request',
                    value: `From ${sourceBranch} to ${targetBranch}`,
                });
                if (!name) {
                    warn('PR name input cancelled by user');
                    return;
                }
                debugClick(`Creating pull request: ${sourceBranch} → ${targetBranch} (${name})`);
                await client.createPullRequest(sourceBranch, targetBranch, name);
                debugClick(`Pull request created successfully: ${name}`);
                vscode.window.showInformationMessage('Created pull request.');
                await tree.load();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                error(`Failed to create pull request: ${message}`);
                reportError('create pull request', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.openRepoBrowser', () => {
            debugClick('Button clicked: rhodecode.openRepoBrowser');
            RepoBrowserPanel.createOrShow(context);
            debugClick('Repository browser panel opened');
        }),

        // Issue #16: Open PR for current branch
        vscode.commands.registerCommand('rhodecode.openCurrentBranchPr', async (pr?: RhodeCodePullRequest) => {
            debugClick('Button clicked: rhodecode.openCurrentBranchPr');
            const client = getClient();
            if (!client) {
                warn('No client available for opening current branch PR');
                return;
            }

            // If PR passed as argument, use it; otherwise fetch it
            let pullRequest: RhodeCodePullRequest | undefined = pr;
            if (!pullRequest) {
                const folder = vscode.workspace.workspaceFolders?.[0];
                if (!folder) {
                    warn('No workspace folder found for current branch PR');
                    return;
                }
                const branch = await getCurrentBranch(folder.uri.fsPath);
                if (!branch) {
                    warn('No current branch detected for PR lookup');
                    return;
                }
                debugClick(`Looking up PR for current branch: ${branch}`);
                // getPullRequests() (default status 'new') already returns open PRs.
                const prs = await client.getPullRequests();
                pullRequest = prs.find((p) => p.source.reference.name === branch);
            }

            if (!pullRequest) {
                warn(`No pull request found for current branch`);
                vscode.window.showInformationMessage('No pull request found for current branch.');
                return;
            }

            debugClick(`Found PR #${pullRequest.pull_request_id} for current branch, showing options`);
            // Show options for opening the PR
            const choice = await vscode.window.showQuickPick(
                [
                    { label: 'Open in Browser', value: 'browser' },
                    { label: 'Open in VS Code', value: 'vscode' },
                ],
                { placeHolder: 'How do you want to open the pull request?' },
            );

            if (choice?.value === 'browser') {
                debugClick(`Opening PR #${pullRequest.pull_request_id} in browser`);
                await vscode.env.openExternal(vscode.Uri.parse(client.pullRequestUrl(pullRequest.pull_request_id)));
                debugClick(`PR #${pullRequest.pull_request_id} opened in browser`);
            } else if (choice?.value === 'vscode') {
                debugClick(`Opening PR #${pullRequest.pull_request_id} in VS Code comment view`);
                await commentView.show(pullRequest);
            } else {
                warn('PR open method selection cancelled by user');
            }
        }),

        // Issue #16: Create PR for current branch
        vscode.commands.registerCommand('rhodecode.createPrForCurrentBranch', async (prefillBranch?: string) => {
            debugClick('Button clicked: rhodecode.createPrForCurrentBranch');
            const client = getClient();
            if (!client) {
                warn('No client available for creating PR for current branch');
                return;
            }

            const folder = vscode.workspace.workspaceFolders?.[0];
            if (!folder) {
                warn('No workspace folder found for creating PR');
                return;
            }

            const branch = prefillBranch || (await getCurrentBranch(folder.uri.fsPath));
            if (!branch) {
                warn('No branch detected for PR creation');
                vscode.window.showErrorMessage('No branch detected.');
                return;
            }

            // Skip default branches
            const defaultBranches = new Set(['master', 'main', 'trunk']);
            if (defaultBranches.has(branch.toLowerCase())) {
                debugClick(`Skipping PR creation for default branch: ${branch}`);
                vscode.window.showInformationMessage(
                    `Branch "${branch}" is a default branch and typically doesn't need a pull request.`,
                );
                return;
            }

            try {
                debugClick(`Creating PR for branch: ${branch}`);
                const targetBranch = await vscode.window.showInputBox({
                    placeHolder: 'Target branch name',
                    prompt: 'Please enter the branch name to merge into',
                    value: 'master',
                });
                if (!targetBranch) {
                    warn('Target branch input cancelled by user');
                    return;
                }
                debugClick(`Target branch: ${targetBranch}, prompting for PR name`);
                const name = await vscode.window.showInputBox({
                    placeHolder: 'Pull request name',
                    prompt: 'Please enter a name for your pull request',
                    value: `From ${branch} to ${targetBranch}`,
                });
                if (!name) {
                    warn('PR name input cancelled by user');
                    return;
                }
                debugClick(`Creating PR: ${branch} → ${targetBranch} (${name})`);
                await client.createPullRequest(branch, targetBranch, name);
                debugClick(`PR created successfully: ${name}`);
                vscode.window.showInformationMessage(`Created pull request for branch "${branch}".`);
                await tree.load();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                error(`Failed to create PR for current branch: ${message}`);
                reportError('create pull request', err);
            }
        }),
    );
}

async function pickPullRequest(client: RhodeCodeClient): Promise<RhodeCodePullRequest | undefined> {
    const prs = await client.getPullRequests();
    if (prs.length === 0) {
        vscode.window.showInformationMessage('No open pull requests found.');
        return undefined;
    }
    const picked = await vscode.window.showQuickPick(
        prs.map((pr) => ({
            label: `#${pr.pull_request_id} ${pr.title}`,
            description: `${pr.status} · ${pr.review_status}`,
            pr,
        })),
        { placeHolder: 'Select a pull request' },
    );
    return picked?.pr;
}

/**
 * Count open tasks (TODO comments not yet resolved). Best effort: on
 * servers without get_pull_request_comments (pre-4.6) returns 0 so the
 * merge flow is not blocked by a version mismatch.
 */
async function countOpenTasks(client: RhodeCodeClient, pr: RhodeCodePullRequest): Promise<number> {
    try {
        const comments = await client.getPullRequestComments(pr.pull_request_id);
        return comments.filter((c) => c.comment_type === 'todo' && !c.comment_resolved_by).length;
    } catch {
        return 0;
    }
}
