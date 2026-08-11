import * as vscode from 'vscode';
import { RhodeCodeClient, reportError } from './rhodecoderequest';
import { RhodeCodePullRequest } from './model/rhodecode';
import { PullRequestItem, PullRequestTreeProvider } from './pullRequestTreeProvider';
import { CommentViewProvider } from './commentViewProvider';
import { setupConnection, browseRepositories } from './serverSetup';
import { setApiKey, setServerUrl, isApiKeyFromEnvEnabled } from './configuration';
import { setStoredRepo } from './repoState';
import { getCurrentBranch } from './gitRemote';
import { RepoBrowserPanel } from './repoBrowserPanel';

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
            try {
                const result = await setupConnection(prefillServer);
                if (!result) {
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
                await refreshAll();
            } catch (err) {
                reportError('connect', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.selectRepository', async () => {
            const initialClient = getClient();
            if (!initialClient) {
                await vscode.commands.executeCommand('rhodecode.connect');
            }
            // rhodecode.connect reports its own errors and calls setClient() on
            // success; re-check so a successful connect flows straight into repo
            // selection instead of forcing the user to invoke this command twice.
            const client = initialClient ?? getClient();
            if (!client) {
                return;
            }
            try {
                const repo = await browseRepositories(client);
                if (!repo) {
                    return;
                }
                await setStoredRepo(repo);
                // Rebuild the client so it points at the newly chosen repo.
                setClient(new RhodeCodeClient(client.getServerUrl(), client.getApiKey(), repo.repo_name));
                await refreshAll();
            } catch (err) {
                reportError('select repository', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.openChangeset', async (sha?: string) => {
            const client = getClient();
            if (!client || !sha) {
                return;
            }
            await vscode.env.openExternal(vscode.Uri.parse(client.changesetUrl(sha)));
        }),

        vscode.commands.registerCommand('rhodecode.refresh', async () => {
            const client = getClient();
            if (!client) {
                return;
            }
            try {
                await tree.load();
            } catch (err) {
                reportError('refresh', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.showPullRequests', async () => {
            const client = getClient();
            if (!client) {
                return;
            }
            try {
                const prs = await client.getPullRequests();
                if (prs.length === 0) {
                    vscode.window.showInformationMessage('No open pull requests found.');
                    return;
                }
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
                    await commentView.show(picked.pr);
                }
            } catch (err) {
                reportError('load pull requests', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.showComments', async (item?: PullRequestItem) => {
            const client = getClient();
            if (!client) {
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                return;
            }
            try {
                await commentView.show(pr);
            } catch (err) {
                reportError('show comments', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.replyComment', async (item?: PullRequestItem) => {
            const client = getClient();
            if (!client) {
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                return;
            }
            const text = await vscode.window.showInputBox({
                prompt: 'Reply on pull request #' + pr.pull_request_id,
                placeHolder: 'Your reply',
            });
            if (!text) {
                return;
            }
            try {
                await client.commentOnPullRequest(pr.pull_request_id, text);
                await tree.invalidateComments(pr);
                vscode.window.showInformationMessage('Reply posted.');
            } catch (err) {
                reportError('reply', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.markHandled', async (item?: PullRequestItem) => {
            const client = getClient();
            if (!client) {
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                return;
            }
            await commentView.show(pr);
        }),

        vscode.commands.registerCommand('rhodecode.markUnhandled', async (item?: PullRequestItem) => {
            const client = getClient();
            if (!client) {
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                return;
            }
            await commentView.show(pr);
        }),

        vscode.commands.registerCommand('rhodecode.openPullRequest', async (item?: PullRequestItem) => {
            const client = getClient();
            if (!client) {
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                return;
            }
            await vscode.env.openExternal(vscode.Uri.parse(client.pullRequestUrl(pr.pull_request_id)));
        }),

        vscode.commands.registerCommand('rhodecode.approveAndMerge', async (item?: PullRequestItem) => {
            const client = getClient();
            if (!client) {
                return;
            }
            const pr = item?.pr ?? (await pickPullRequest(client));
            if (!pr) {
                return;
            }

            // Check for open tasks (TODO comments): RhodeCode blocks merging
            // while tasks are unresolved, so warn before attempting.
            const openTasks = await countOpenTasks(client, pr);
            if (openTasks > 0) {
                const proceed = await vscode.window.showQuickPick(['No', 'Yes'], {
                    ignoreFocusOut: true,
                    placeHolder: `#${pr.pull_request_id} has ${openTasks} open task${openTasks > 1 ? 's' : ''}. Resolve them in the comments view first. Merge anyway?`,
                });
                if (proceed !== 'Yes') {
                    return;
                }
            }

            const answer = await vscode.window.showQuickPick(['Yes', 'No'], {
                ignoreFocusOut: true,
                placeHolder: `Approve and merge #${pr.pull_request_id}?`,
            });
            if (answer !== 'Yes') {
                return;
            }
            await vscode.window.withProgress(
                {
                    title: 'Merging pull request',
                    location: vscode.ProgressLocation.Notification,
                },
                async (progress) => {
                    try {
                        if (pr.review_status !== 'approved') {
                            progress.report({ message: 'Approving…' });
                            await client.approvePullRequest(pr.pull_request_id);
                        }
                        progress.report({ message: 'Merging…' });
                        await client.mergePullRequest(pr.pull_request_id);
                        vscode.window.showInformationMessage('Successfully merged the pull request.');
                        await tree.load();
                    } catch (err) {
                        reportError('approve/merge', err);
                    }
                },
            );
        }),

        vscode.commands.registerCommand('rhodecode.addMessage', async () => {
            const client = getClient();
            if (!client) {
                return;
            }
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showInformationMessage(
                    'No active editor. Open a file from the pull request to add a message.',
                );
                return;
            }
            const pr = await pickPullRequest(client);
            if (!pr) {
                return;
            }
            const line = editor.selection.active.line + 1;
            const filePath = editor.document.fileName;
            const message = await vscode.window.showInputBox({
                prompt: `Add a message to line ${line} in ${filePath} on PR #${pr.pull_request_id}`,
                placeHolder: 'Your message',
            });
            if (!message) {
                return;
            }
            try {
                // Use commentOnPullRequest with line number info in the message
                const fullMessage = `@line:${line} ${message}`;
                await client.commentOnPullRequest(pr.pull_request_id, fullMessage);
                await tree.invalidateComments(pr);
                vscode.window.showInformationMessage('Message added.');
            } catch (err) {
                reportError('add message', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.createPullRequest', async (prefillSourceBranch?: string) => {
            const client = getClient();
            if (!client) {
                return;
            }
            try {
                const sourceBranch = await vscode.window.showInputBox({
                    placeHolder: 'Source branch name',
                    prompt: 'Please enter the branch name of the source branch',
                    value: prefillSourceBranch,
                });
                if (!sourceBranch) {
                    return;
                }
                const targetBranch = await vscode.window.showInputBox({
                    placeHolder: 'Target branch name',
                    prompt: 'Please enter the branch name of the target branch',
                    value: 'master',
                });
                if (!targetBranch) {
                    return;
                }
                const name = await vscode.window.showInputBox({
                    placeHolder: 'Pull request name',
                    prompt: 'Please enter a name for your pull request',
                    value: `From ${sourceBranch} to ${targetBranch}`,
                });
                if (!name) {
                    return;
                }
                await client.createPullRequest(sourceBranch, targetBranch, name);
                vscode.window.showInformationMessage('Created pull request.');
                await tree.load();
            } catch (err) {
                reportError('create pull request', err);
            }
        }),

        vscode.commands.registerCommand('rhodecode.openRepoBrowser', () => {
            RepoBrowserPanel.createOrShow(context);
        }),

        // Issue #16: Open PR for current branch
        vscode.commands.registerCommand('rhodecode.openCurrentBranchPr', async (pr?: RhodeCodePullRequest) => {
            const client = getClient();
            if (!client) {
                return;
            }

            // If PR passed as argument, use it; otherwise fetch it
            let pullRequest: RhodeCodePullRequest | undefined = pr;
            if (!pullRequest) {
                const folder = vscode.workspace.workspaceFolders?.[0];
                if (!folder) {
                    return;
                }
                const branch = await getCurrentBranch(folder.uri.fsPath);
                if (!branch) {
                    return;
                }
                // getPullRequests() (default status 'new') already returns open PRs.
                const prs = await client.getPullRequests();
                pullRequest = prs.find((p) => p.source.reference.name === branch);
            }

            if (!pullRequest) {
                vscode.window.showInformationMessage('No pull request found for current branch.');
                return;
            }

            // Show options for opening the PR
            const choice = await vscode.window.showQuickPick(
                [
                    { label: 'Open in Browser', value: 'browser' },
                    { label: 'Open in VS Code', value: 'vscode' },
                ],
                { placeHolder: 'How do you want to open the pull request?' },
            );

            if (choice?.value === 'browser') {
                await vscode.env.openExternal(vscode.Uri.parse(client.pullRequestUrl(pullRequest.pull_request_id)));
            } else if (choice?.value === 'vscode') {
                await commentView.show(pullRequest);
            }
        }),

        // Issue #16: Create PR for current branch
        vscode.commands.registerCommand('rhodecode.createPrForCurrentBranch', async (prefillBranch?: string) => {
            const client = getClient();
            if (!client) {
                return;
            }

            const folder = vscode.workspace.workspaceFolders?.[0];
            if (!folder) {
                return;
            }

            const branch = prefillBranch || (await getCurrentBranch(folder.uri.fsPath));
            if (!branch) {
                vscode.window.showErrorMessage('No branch detected.');
                return;
            }

            // Skip default branches
            const defaultBranches = new Set(['master', 'main', 'trunk']);
            if (defaultBranches.has(branch.toLowerCase())) {
                vscode.window.showInformationMessage(
                    `Branch "${branch}" is a default branch and typically doesn't need a pull request.`,
                );
                return;
            }

            try {
                const targetBranch = await vscode.window.showInputBox({
                    placeHolder: 'Target branch name',
                    prompt: 'Please enter the branch name to merge into',
                    value: 'master',
                });
                if (!targetBranch) {
                    return;
                }

                const name = await vscode.window.showInputBox({
                    placeHolder: 'Pull request name',
                    prompt: 'Please enter a name for your pull request',
                    value: `From ${branch} to ${targetBranch}`,
                });
                if (!name) {
                    return;
                }

                await client.createPullRequest(branch, targetBranch, name);
                vscode.window.showInformationMessage(`Created pull request for branch "${branch}".`);
                await tree.load();
            } catch (err) {
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
