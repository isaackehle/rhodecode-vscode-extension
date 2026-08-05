import * as vscode from 'vscode';
import { RhodeCodeClient } from './rhodecoderequest';
import { RhodeCodePullRequest } from './model/rhodecode';
import { parsePullRequestComments } from './commentParser';
import { PullRequestTreeProvider } from './pullRequestTreeProvider';

/**
 * Webview panel that shows the comment thread for a pull request and lets
 * you reply and toggle the "handled" flag on each comment.
 */
export class CommentViewProvider {
    public static readonly viewType = 'rhodecode.comments';

    private panel: vscode.WebviewPanel | undefined;
    private pr: RhodeCodePullRequest | undefined;

    constructor(
        private readonly getClient: () => RhodeCodeClient | undefined,
        private readonly tree: PullRequestTreeProvider
    ) {}

    async show(pr: RhodeCodePullRequest): Promise<void> {
        this.pr = pr;

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                CommentViewProvider.viewType,
                `RhodeCode #${pr.pull_request_id}`,
                vscode.ViewColumn.One,
                { enableScripts: true, retainContextWhenHidden: true }
            );
            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });
            this.panel.webview.onDidReceiveMessage(async (message) => {
                await this.handleMessage(message);
            });
        } else {
            this.panel.title = `RhodeCode #${pr.pull_request_id}`;
            this.panel.reveal(vscode.ViewColumn.One);
        }

        await this.render();
    }

    private async handleMessage(message: { type: string; commentId?: string; text?: string }): Promise<void> {
        if (!this.pr) {
            return;
        }
        const client = this.getClient();
        if (!client) {
            vscode.window.showErrorMessage('RhodeCode is not configured');
            return;
        }

        const repoId = await getRepoIdForStore();

        switch (message.type) {
            case 'reply': {
                const commentId = message.commentId;
                const text = message.text;
                if (!commentId || !text) {
                    return;
                }
                await client.commentOnPullRequest(this.pr.pull_request_id, text);
                await this.tree.invalidateComments(this.pr);
                await this.render();
                break;
            }
            case 'toggleHandled': {
                const commentId = message.commentId;
                if (!commentId) {
                    return;
                }
                const handled = this.tree.store.isHandled(repoId, this.pr.pull_request_id, commentId);
                this.tree.store.setHandled(repoId, this.pr.pull_request_id, commentId, !handled);
                if (!handled && getMarkHandledPostsComment()) {
                    await client.commentOnPullRequest(this.pr.pull_request_id, 'Marked as handled ✔');
                }
                await this.render();
                break;
            }
            default:
                break;
        }
    }

    private async render(): Promise<void> {
        if (!this.panel || !this.pr) {
            return;
        }
        const client = this.getClient();
        if (!client) {
            return;
        }
        const repoId = await getRepoIdForStore();
        const html = await this.tree.getCommentsHtml(this.pr);
        const comments = parsePullRequestComments(html);

        const rows = comments
            .map((comment) => {
                const handled = this.tree.store.isHandled(repoId, this.pr!.pull_request_id, comment.commentId);
                const statusBadge = comment.statusChange
                    ? `<span class="badge">${escapeHtml(comment.statusChange)}</span>`
                    : '';
                const handledBadge = handled ? '<span class="badge handled">handled</span>' : '';
                return `
<div class="comment ${handled ? 'is-handled' : ''}">
  <div class="meta">
    <span class="author">${escapeHtml(comment.author || 'unknown')}</span>
    <span class="date">${escapeHtml(comment.date)}</span>
    ${statusBadge}
    ${handledBadge}
  </div>
  <div class="text">${escapeHtml(comment.text)}</div>
  <div class="actions">
    <button data-action="reply" data-comment="${comment.commentId}">Reply</button>
    <button data-action="toggle" data-comment="${comment.commentId}">${handled ? 'Mark unhandled' : 'Mark handled'}</button>
  </div>
</div>`;
            })
            .join('\n');

        const empty = comments.length === 0
            ? '<p class="empty">No comments on this pull request yet.</p>'
            : '';

        this.panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<style>
body { font-family: var(--vscode-font-family); padding: 1rem; color: var(--vscode-foreground); }
h2 { font-size: 1.1rem; }
.comment { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: .6rem .8rem; margin-bottom: .7rem; }
.comment.is-handled { opacity: .55; }
.meta { font-size: .8rem; color: var(--vscode-descriptionForeground); margin-bottom: .35rem; }
.author { font-weight: 600; color: var(--vscode-foreground); }
.date { margin-left: .5rem; }
.badge { display: inline-block; margin-left: .5rem; padding: 0 .35rem; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: .7rem; }
.badge.handled { background: var(--vscode-charts-green); color: #fff; }
.text { white-space: pre-wrap; }
.actions { margin-top: .5rem; }
button { margin-right: .5rem; cursor: pointer; }
.empty { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<h2>Comments on #${this.pr.pull_request_id} ${escapeHtml(this.pr.title)}</h2>
${empty}
${rows}
<script>
(function(){
  const vscode = acquireVsCodeApi();
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const commentId = btn.getAttribute('data-comment');
    if (btn.getAttribute('data-action') === 'reply') {
      const text = prompt('Reply:');
      if (text && text.trim()) {
        vscode.postMessage({ type: 'reply', commentId, text: text.trim() });
      }
    } else {
      vscode.postMessage({ type: 'toggleHandled', commentId });
    }
  });
})();
</script>
</body>
</html>`;
    }

    dispose(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }
}

async function getRepoIdForStore(): Promise<string> {
    const cfg = vscode.workspace.getConfiguration('rhodecode');
    return cfg.get<string>('repoid', '');
}

function getMarkHandledPostsComment(): boolean {
    const cfg = vscode.workspace.getConfiguration('rhodecode');
    return cfg.get<boolean>('markHandledPostsComment', false);
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
