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
import { debugOutputChannel, logClick, logWarn, logError } from './extension';

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
            logClick('Button clicked: rhodecode.connect');
            try {
                const result = await setupConnection(prefillServer);
                if (!result) {
                    logWarn('Connection cancelled by user');
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
                logClick('Connection successful');
                await refreshAll();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError(`Connection failed: ${message}`);
                reportError('connect', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.openDebugOutput', async () => {
            logClick('Button clicked: rhodecode.openDebugOutput');
            if (debugOutputChannel) {
                debugOutputChannel.show(true);
                logClick('Debug output channel opened');
            } else {
                logWarn('Debug output channel not available');
                vscode.window.showInformationMessage('RhodeCode debug output channel not available yet.');
            }
        }),

        vscode.commands.registerCommand('rhodecode.selectRepository', async () => {
            logClick('Button clicked: rhodecode.selectRepository');
            const initialClient = getClient();
            if (!initialClient) {
                logClick('No client, initiating connect flow');
                await vscode.commands.executeCommand('rhodecode.connect');
            }
            // rhodecode.connect reports its own errors and calls setClient() on
            // success; re-check so a successful connect flows straight into repo
            // selection instead of forcing the user to invoke this command twice.
            const client = initialClient ?? getClient();
            if (!client) {
                logWarn('No client available for repository selection');
                return;
            }
            try {
                logClick('Opening repository browser');
                const repo = await browseRepositories(client);
                if (!repo) {
                    logWarn('Repository selection cancelled by user');
                    return;
                }
                await setStoredRepo(repo);
                // Rebuild the client so it points at the newly chosen repo.
                setClient(new RhodeCodeClient(client.getServerUrl(), client.getApiKey(), repo.repo_name));
                logClick(`Repository selected: ${repo.repo_name}`);
                await refreshAll();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError(`Failed to select repository: ${message}`);
                reportError('select repository', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.toggleGroup', async (item: GroupItem) => {
            logClick(`Button clicked: rhodecode.toggleGroup on group "${item.group.group_name}"`);
            if (!tree) {
                logWarn('Tree provider not available for toggleGroup');
                return;
            }
            tree.toggleGroupSelection(item.group.group_id);
            logClick(`Group "${item.group.group_name}" toggled`);
        }),

        vscode.commands.registerCommand('rhodecode.selectRepoFromTree', async (item: RepoItem) => {
            logClick(`Button clicked: rhodecode.selectRepoFromTree on "${item.repo.repo_name}"`);
            if (!tree) {
                logWarn('Tree provider not available for selectRepoFromTree');
                return;
            }
            try {
                const client = getClient();
                if (!client) {
                    logWarn('No client available for repository selection from tree');
                    return;
                }
                await setStoredRepo(item.repo);
                // Rebuild the client so it points at the newly chosen repo.
                setClient(new RhodeCodeClient(client.getServerUrl(), client.getApiKey(), item.repo.repo_name));
                logClick(`Repository selected from tree: ${item.repo.repo_name}`);
                await refreshAll();
                vscode.window.showInformationMessage(`Selected repository "${item.repo.repo_name}"`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError(`Failed to select repository from tree: ${message}`);
                reportError('select repo from tree', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.openChangeset', async (sha?: string) => {
            logClick(`Button clicked: rhodecode.openChangeset for commit ${sha?.slice(0, 8) || 'unknown'}`);
            const client = getClient();
            if (!client) {
                logWarn('No client available for opening changeset');
                return;
            }
            if (!sha) {
                logWarn('No commit SHA provided for opening changeset');
                return;
            }
            try {
                const url = client.changesetUrl(sha);
                await vscode.env.openExternal(vscode.Uri.parse(url));
                logClick(`Opened changeset in browser: ${url}`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError(`Failed to open changeset: ${message}`);
            }
        }),

        vscode.commands.registerCommand('rhodecode.switchBranch', async (item?: vscode.TreeItem) => {
            logClick('Button clicked: rhodecode.switchBranch');
            const client = getClient();
            if (!client) {
                logWarn('No client available for switching branch');
                return;
            }
            // Extract branch name from the item label
            const branchName = item?.label as string | undefined;
            if (!branchName) {
                logWarn('No branch name found in tree item');
                vscode.window.showErrorMessage('No branch name found.');
                return;
            }
            try {
                logClick(`Switching to branch: ${branchName}`);
                // Use git command to checkout the branch
                const { exec } = await import('child_process');
                const { promisify } = await import('util');
                const execAsync = promisify(exec);
                const folder = vscode.workspace.workspaceFolders?.[0];
                if (!folder) {
                    logWarn('No workspace folder found for git checkout');
                    vscode.window.showErrorMessage('No workspace folder found.');
                    return;
                }
                await execAsync(`git checkout ${branchName}`, { cwd: folder.uri.fsPath });
                logClick(`Successfully switched to branch: ${branchName}`);
                logClick('Refreshing tree view after branch switch');
                await tree.updateCurrentBranch();
                await tree.load();
                logClick('Tree view refreshed after branch switch');
                vscode.window.showInformationMessage(`Switched to branch "${branchName}"`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError(`Failed to switch to branch ${branchName}: ${message}`);
                vscode.window.showErrorMessage(`Failed to switch to branch "${branchName}": ${message}`);
            }
        }),

        vscode.commands.registerCommand('rhodecode.switchTag', async (item?: vscode.TreeItem) => {
            logClick('Button clicked: rhodecode.switchTag');
            const client = getClient();
            if (!client) {
                logWarn('No client available for switching tag');
                return;
            }
            // Extract tag name from the item label
            const tagName = item?.label as string | undefined;
            if (!tagName) {
                logWarn('No tag name found in tree item');
                vscode.window.showErrorMessage('No tag name found.');
                return;
            }
            try {
                logClick(`Switching to tag: ${tagName}`);
                // Use git command to checkout the tag
                const { exec } = await import('child_process');
                const { promisify } = await import('util');
                const execAsync = promisify(exec);
                const folder = vscode.workspace.workspaceFolders?.[0];
                if (!folder) {
                    logWarn('No workspace folder found for git checkout');
                    vscode.window.showErrorMessage('No workspace folder found.');
                    return;
                }
                await execAsync(`git checkout ${tagName}`, { cwd: folder.uri.fsPath });
                logClick(`Successfully switched to tag: ${tagName}`);
                await tree.updateCurrentBranch();
                logClick('Updated current branch in tree view');
                vscode.window.showInformationMessage(`Switched to tag "${tagName}"`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError(`Failed to switch to tag ${tagName}: ${message}`);
                vscode.window.showErrorMessage(`Failed to switch to tag "${tagName}": ${message}`);
            }
        }),

        vscode.commands.registerCommand('rhodecode.refresh', async () => {
            logClick('Button clicked: rhodecode.refresh');
            const client = getClient();
            if (!client) {
                logWarn('No client available for refresh');
                return;
            }
            try {
                logClick('Loading tree data');
                await tree.load();
                logClick('Refresh completed successfully');
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError(`Refresh failed: ${message}`);
                reportError('refresh', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.showPullRequests', async () => {
            logClick('Button clicked: rhodecode.showPullRequests');
            const client = getClient();
            if (!client) {
                logWarn('No client available for showing pull requests');
                return;
            }
            try {
                logClick('Fetching pull requests from server');
                const prs = await client.getPullRequests();
                if (prs.length === 0) {
                    logWarn('No open pull requests found on server');
                    vscode.window.showInformationMessage('No open pull requests found.');
                    return;
                }
                logClick(`Found ${prs.length} pull requests, showing quick pick`);
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
                    logClick(`Selected pull request #${picked.pr.pull_request_id}`);
                    await commentView.show(picked.pr);
                } else {
                    logWarn('Pull request selection cancelled by user');
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError(`Failed to load pull requests: ${message}`);
                reportError('load pull requests', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.showComments', async (item?: PullRequestItem) => {
            logClick('Button clicked: rhodecode.showComments');
            const client = getClient();
            if (!client) {
                logWarn('No client available for showing comments');
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                logWarn('No pull request selected for showing comments');
                return;
            }
            try {
                logClick(`Showing comments for PR #${pr.pull_request_id}`);
                await commentView.show(pr);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError(`Failed to show comments for PR #${pr.pull_request_id}: ${message}`);
                reportError('show comments', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.replyComment', async (item?: PullRequestItem) => {
            logClick('Button clicked: rhodecode.replyComment');
            const client = getClient();
            if (!client) {
                logWarn('No client available for replying to comments');
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                logWarn('No pull request selected for replying');
                return;
            }
            logClick(`Opening reply input for PR #${pr.pull_request_id}`);
            const text = await vscode.window.showInputBox({
                prompt: 'Reply on pull request #' + pr.pull_request_id,
                placeHolder: 'Your reply',
            });
            if (!text) {
                logWarn('Reply cancelled by user');
                return;
            }
            try {
                logClick(`Posting reply to PR #${pr.pull_request_id}`);
                await client.commentOnPullRequest(pr.pull_request_id, text);
                await tree.invalidateComments(pr);
                logClick('Reply posted successfully');
                vscode.window.showInformationMessage('Reply posted.');
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError(`Failed to post reply to PR #${pr.pull_request_id}: ${message}`);
                reportError('reply', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.markHandled', async (item?: PullRequestItem) => {
            logClick('Button clicked: rhodecode.markHandled');
            const client = getClient();
            if (!client) {
                logWarn('No client available for marking as handled');
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                logWarn('No pull request selected for marking handled');
                return;
            }
            logClick(`Marking comments as handled for PR #${pr.pull_request_id}`);
            await commentView.show(pr);
        }),

        vscode.commands.registerCommand('rhodecode.markUnhandled', async (item?: PullRequestItem) => {
            logClick('Button clicked: rhodecode.markUnhandled');
            const client = getClient();
            if (!client) {
                logWarn('No client available for marking as unhandled');
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                logWarn('No pull request selected for marking unhandled');
                return;
            }
            logClick(`Marking comments as unhandled for PR #${pr.pull_request_id}`);
            await commentView.show(pr);
        }),

        vscode.commands.registerCommand('rhodecode.openPullRequest', async (item?: PullRequestItem) => {
            logClick('Button clicked: rhodecode.openPullRequest');
            const client = getClient();
            if (!client) {
                logWarn('No client available for opening pull request');
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                logWarn('No pull request selected for opening');
                return;
            }
            try {
                const url = client.pullRequestUrl(pr.pull_request_id);
                logClick(`Opening pull request #${pr.pull_request_id} in browser: ${url}`);
                await vscode.env.openExternal(vscode.Uri.parse(url));
                logClick(`Pull request #${pr.pull_request_id} opened in browser`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError(`Failed to open pull request #${pr.pull_request_id}: ${message}`);
            }
        }),

        vscode.commands.registerCommand('rhodecode.approveAndMerge', async (item?: PullRequestItem) => {
            logClick('Button clicked: rhodecode.approveAndMerge');
            const client = getClient();
            if (!client) {
                logWarn('No client available for approve and merge');
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                logWarn('No pull request selected for approve and merge');
                return;
            }
            logClick(`Preparing to approve and merge PR #${pr.pull_request_id}`);

            // Check for open tasks (TODO comments): RhodeCode blocks merging
            // while tasks are unresolved, so warn before attempting.
            const openTasks = await countOpenTasks(client, pr);
            if (openTasks > 0) {
                logClick(`Found ${openTasks} open task${openTasks > 1 ? 's' : ''} on PR #${pr.pull_request_id}`);
                const proceed = await vscode.window.showQuickPick(['No', 'Yes'], {
                    ignoreFocusOut: true,
                    placeHolder: `#${pr.pull_request_id} has ${openTasks} open task${openTasks > 1 ? 's' : ''}. Resolve them in the comments view first. Merge anyway?`,
                });
                if (proceed !== 'Yes') {
                    logWarn(`User declined to merge PR #${pr.pull_request_id} with open tasks`);
                    return;
                }
            }

            const answer = await vscode.window.showQuickPick(['Yes', 'No'], {
                ignoreFocusOut: true,
                placeHolder: `Approve and merge #${pr.pull_request_id}?`,
            });
            if (answer !== 'Yes') {
                logWarn(`User declined to approve and merge PR #${pr.pull_request_id}`);
                return;
            }
            logClick(`User confirmed approve and merge for PR #${pr.pull_request_id}`);
            await vscode.window.withProgress(
                {
                    title: 'Merging pull request',
                    location: vscode.ProgressLocation.Notification,
                },
                async (progress) => {
                    try {
                        if (pr.review_status !== 'approved') {
                            progress.report({ message: 'Approving…' });
                            logClick(`Approving PR #${pr.pull_request_id}`);
                            await client.approvePullRequest(pr.pull_request_id);
                            logClick(`PR #${pr.pull_request_id} approved`);
                        }
                        progress.report({ message: 'Merging…' });
                        logClick(`Merging PR #${pr.pull_request_id}`);
                        await client.mergePullRequest(pr.pull_request_id);
                        logClick(`PR #${pr.pull_request_id} merged successfully`);
                        vscode.window.showInformationMessage('Successfully merged the pull request.');
                        await tree.load();
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        logError(`Failed to approve/merge PR #${pr.pull_request_id}: ${message}`);
                        reportError('approve/merge', err);
                    }
                },
            );
        }),

        vscode.commands.registerCommand('rhodecode.addMessage', async () => {
            logClick('Button clicked: rhodecode.addMessage');
            const client = getClient();
            if (!client) {
                logWarn('No client available for adding message');
                return;
            }
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                logWarn('No active editor for adding message');
                vscode.window.showInformationMessage(
                    'No active editor. Open a file from the pull request to add a message.',
                );
                return;
            }
            const pr = await pickPullRequest(client);
            if (!pr) {
                logWarn('No pull request selected for adding message');
                return;
            }
            const line = editor.selection.active.line + 1;
            const filePath = editor.document.fileName;
            logClick(`Adding message to line ${line} in ${filePath} on PR #${pr.pull_request_id}`);
            const message = await vscode.window.showInputBox({
                prompt: `Add a message to line ${line} in ${filePath} on PR #${pr.pull_request_id}`,
                placeHolder: 'Your message',
            });
            if (!message) {
                logWarn('Message input cancelled by user');
                return;
            }
            try {
                // Use commentOnPullRequest with line number info in the message
                const fullMessage = `@line:${line} ${message}`;
                logClick(`Posting message to PR #${pr.pull_request_id}`);
                await client.commentOnPullRequest(pr.pull_request_id, fullMessage);
                await tree.invalidateComments(pr);
                logClick('Message added successfully');
                vscode.window.showInformationMessage('Message added.');
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError(`Failed to add message to PR #${pr.pull_request_id}: ${message}`);
                reportError('add message', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.createPullRequest', async (prefillSourceBranch?: string) => {
            logClick('Button clicked: rhodecode.createPullRequest');
            const client = getClient();
            if (!client) {
                logWarn('No client available for creating pull request');
                return;
            }
            try {
                // Step 1: Enter PR name (not target branch)
                const name = await vscode.window.showInputBox({
                    placeHolder: 'Pull request name',
                    prompt: 'Enter a name for the pull request',
                    value: prefillSourceBranch ? `From ${prefillSourceBranch}` : '',
                });
                if (!name) {
                    logWarn('PR name input cancelled by user');
                    return;
                }

                // Step 2: Confirm details
                const sourceBranch =
                    prefillSourceBranch ||
                    (await vscode.window.showInputBox({
                        placeHolder: 'Source branch name',
                        prompt: 'Please enter the branch name of the source branch',
                    }));
                if (!sourceBranch) {
                    logWarn('Source branch input cancelled by user');
                    return;
                }

                const targetBranch = await vscode.window.showInputBox({
                    placeHolder: 'Target branch name',
                    prompt: 'Please enter the branch name of the target branch',
                    value: 'master',
                });
                if (!targetBranch) {
                    logWarn('Target branch input cancelled by user');
                    return;
                }

                // Step 3: Confirmation screen
                const confirmMsg = `Create pull request:\n\nFrom: ${sourceBranch}\nTo: ${targetBranch}\nName: ${name}\n\nClick OK to create.`;
                const confirm = await vscode.window.showWarningMessage(confirmMsg, { modal: true }, 'OK', 'Cancel');
                if (confirm !== 'OK') {
                    logWarn('PR creation cancelled on confirmation screen');
                    return;
                }

                logClick(`Creating pull request: ${sourceBranch} → ${targetBranch} (${name})`);
                await client.createPullRequest(sourceBranch, targetBranch, name);
                logClick(`Pull request created successfully: ${name}`);

                // Step 4: Show PR ID as toast
                const prs = await client.getPullRequests();
                const newPr = prs.find(
                    (p) => p.source.reference.name === sourceBranch && p.target.reference.name === targetBranch,
                );
                if (newPr) {
                    const prNumber = newPr.pull_request_id;
                    const prUrl = client.pullRequestUrl(prNumber);
                    const toast = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
                    toast.text = `$(git-pull-request) PR #${prNumber}`;
                    toast.tooltip = `Click to open PR #${prNumber}`;
                    toast.command = { command: 'vscode.open', title: 'Open PR', arguments: [vscode.Uri.parse(prUrl)] };
                    toast.show();
                    setTimeout(() => toast.hide(), 10000); // Hide after 10 seconds
                }

                // Step 5: Show PR info with tag toggles
                const addTags = await vscode.window.showInformationMessage(
                    `Pull request created!`,
                    { modal: false },
                    'Add Tags',
                    'Done',
                );
                if (addTags === 'Add Tags' && newPr) {
                    // TODO: Add tag toggles UI
                    vscode.window.showInformationMessage('Tag toggles coming soon.');
                }

                await tree.load();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError(`Failed to create pull request: ${message}`);
                reportError('create pull request', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.openRepoBrowser', () => {
            logClick('Button clicked: rhodecode.openRepoBrowser');
            RepoBrowserPanel.createOrShow(context);
            logClick('Repository browser panel opened');
        }),

        // Issue #16: Open PR for current branch
        vscode.commands.registerCommand('rhodecode.openCurrentBranchPr', async (pr?: RhodeCodePullRequest) => {
            logClick('Button clicked: rhodecode.openCurrentBranchPr');
            const client = getClient();
            if (!client) {
                logWarn('No client available for opening current branch PR');
                return;
            }

            // If PR passed as argument, use it; otherwise fetch it
            let pullRequest: RhodeCodePullRequest | undefined = pr;
            if (!pullRequest) {
                const folder = vscode.workspace.workspaceFolders?.[0];
                if (!folder) {
                    logWarn('No workspace folder found for current branch PR');
                    return;
                }
                const branch = await getCurrentBranch(folder.uri.fsPath);
                if (!branch) {
                    logWarn('No current branch detected for PR lookup');
                    return;
                }
                logClick(`Looking up PR for current branch: ${branch}`);
                // getPullRequests() (default status 'new') already returns open PRs.
                const prs = await client.getPullRequests();
                pullRequest = prs.find((p) => p.source.reference.name === branch);
            }

            if (!pullRequest) {
                logWarn(`No pull request found for current branch`);
                vscode.window.showInformationMessage('No pull request found for current branch.');
                return;
            }

            logClick(`Found PR #${pullRequest.pull_request_id} for current branch, showing options`);
            // Show options for opening the PR
            const choice = await vscode.window.showQuickPick(
                [
                    { label: 'Open in Browser', value: 'browser' },
                    { label: 'Open in VS Code', value: 'vscode' },
                ],
                { placeHolder: 'How do you want to open the pull request?' },
            );

            if (choice?.value === 'browser') {
                logClick(`Opening PR #${pullRequest.pull_request_id} in browser`);
                await vscode.env.openExternal(vscode.Uri.parse(client.pullRequestUrl(pullRequest.pull_request_id)));
                logClick(`PR #${pullRequest.pull_request_id} opened in browser`);
            } else if (choice?.value === 'vscode') {
                logClick(`Opening PR #${pullRequest.pull_request_id} in VS Code comment view`);
                await commentView.show(pullRequest);
            } else {
                logWarn('PR open method selection cancelled by user');
            }
        }),

        // Issue #16: Create PR for current branch
        vscode.commands.registerCommand('rhodecode.createPrForCurrentBranch', async (prefillBranch?: string) => {
            logClick('Button clicked: rhodecode.createPrForCurrentBranch');
            const client = getClient();
            if (!client) {
                logWarn('No client available for creating PR for current branch');
                return;
            }

            const folder = vscode.workspace.workspaceFolders?.[0];
            if (!folder) {
                logWarn('No workspace folder found for creating PR');
                return;
            }

            const branch = prefillBranch || (await getCurrentBranch(folder.uri.fsPath));
            if (!branch) {
                logWarn('No branch detected for PR creation');
                vscode.window.showErrorMessage('No branch detected.');
                return;
            }

            // Skip default branches
            const defaultBranches = new Set(['master', 'main', 'trunk']);
            if (defaultBranches.has(branch.toLowerCase())) {
                logClick(`Skipping PR creation for default branch: ${branch}`);
                vscode.window.showInformationMessage(
                    `Branch "${branch}" is a default branch and typically doesn't need a pull request.`,
                );
                return;
            }

            try {
                logClick(`Creating PR for branch: ${branch}`);
                const targetBranch = await vscode.window.showInputBox({
                    placeHolder: 'Target branch name',
                    prompt: 'Please enter the branch name to merge into',
                    value: 'master',
                });
                if (!targetBranch) {
                    logWarn('Target branch input cancelled by user');
                    return;
                }
                logClick(`Target branch: ${targetBranch}, prompting for PR name`);
                const name = await vscode.window.showInputBox({
                    placeHolder: 'Pull request name',
                    prompt: 'Please enter a name for your pull request',
                    value: `From ${branch} to ${targetBranch}`,
                });
                if (!name) {
                    logWarn('PR name input cancelled by user');
                    return;
                }
                logClick(`Creating PR: ${branch} → ${targetBranch} (${name})`);
                await client.createPullRequest(branch, targetBranch, name);
                logClick(`PR created successfully: ${name}`);
                vscode.window.showInformationMessage(`Created pull request for branch "${branch}".`);
                await tree.load();
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logError(`Failed to create PR for current branch: ${message}`);
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
