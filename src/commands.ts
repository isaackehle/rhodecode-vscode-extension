import * as vscode from 'vscode';
import { RhodeCodeClient, reportError } from './rhodecoderequest';
import { RhodeCodePullRequest } from './model/rhodecode';
import { PullRequestItem, PullRequestTreeProvider } from './pullRequestTreeProvider';
import { CommentViewProvider } from './commentViewProvider';

export function registerCommands(
    context: vscode.ExtensionContext,
    getClient: () => RhodeCodeClient | undefined,
    tree: PullRequestTreeProvider,
    commentView: CommentViewProvider
): void {
    context.subscriptions.push(
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
                        pr
                    })),
                    { placeHolder: 'Select a pull request' }
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
            const pr = item?.pr ?? await pickPullRequest(client);
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
            const pr = item?.pr ?? await pickPullRequest(client);
            if (!pr) {
                return;
            }
            const text = await vscode.window.showInputBox({
                prompt: 'Reply on pull request #' + pr.pull_request_id,
                placeHolder: 'Your reply'
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
            const pr = item?.pr ?? await pickPullRequest(client);
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
            const pr = item?.pr ?? await pickPullRequest(client);
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
            const pr = item?.pr ?? await pickPullRequest(client);
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
            const pr = item?.pr ?? await pickPullRequest(client);
            if (!pr) {
                return;
            }

            // Check for open tasks (TODO comments): RhodeCode blocks merging
            // while tasks are unresolved, so warn before attempting.
            const openTasks = await countOpenTasks(client, pr);
            if (openTasks > 0) {
                const proceed = await vscode.window.showQuickPick(['No', 'Yes'], {
                    ignoreFocusOut: true,
                    placeHolder: `#${pr.pull_request_id} has ${openTasks} open task${openTasks > 1 ? 's' : ''}. Resolve them in the comments view first. Merge anyway?`
                });
                if (proceed !== 'Yes') {
                    return;
                }
            }

            const answer = await vscode.window.showQuickPick(['Yes', 'No'], {
                ignoreFocusOut: true,
                placeHolder: `Approve and merge #${pr.pull_request_id}?`
            });
            if (answer !== 'Yes') {
                return;
            }
            await vscode.window.withProgress(
                {
                    title: 'Merging pull request',
                    location: vscode.ProgressLocation.Notification
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
                }
            );
        }),

        vscode.commands.registerCommand('rhodecode.createPullRequest', async () => {
            const client = getClient();
            if (!client) {
                return;
            }
            try {
                const sourceBranch = await vscode.window.showInputBox({
                    placeHolder: 'Source branch name',
                    prompt: 'Please enter the branch name of the source branch'
                });
                if (!sourceBranch) {
                    return;
                }
                const targetBranch = await vscode.window.showInputBox({
                    placeHolder: 'Target branch name',
                    prompt: 'Please enter the branch name of the target branch',
                    value: 'master'
                });
                if (!targetBranch) {
                    return;
                }
                const name = await vscode.window.showInputBox({
                    placeHolder: 'Pull request name',
                    prompt: 'Please enter a name for your pull request',
                    value: `From ${sourceBranch} to ${targetBranch}`
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
        })
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
            pr
        })),
        { placeHolder: 'Select a pull request' }
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
