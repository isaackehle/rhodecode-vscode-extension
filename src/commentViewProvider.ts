import * as vscode from 'vscode';
import { RhodeCodeClient, reportError } from './rhodecoderequest';
import { PullRequestCommentData, RhodeCodePullRequest } from './model/rhodecode';
import { parsePullRequestComments } from './commentParser';
import { PullRequestTreeProvider } from './pullRequestTreeProvider';
import { getMarkHandledPostsComment } from './configuration';
import { getRepoIdRaw } from './repoState';

interface DisplayComment {
    id: string;
    author: string;
    date: string;
    text: string;
    isTodo: boolean;
    resolved: boolean;
    statusLabel: string | null;
    location: string | null; // file:line for inline comments
}

/**
 * Webview panel that shows the comment thread for a pull request: notes,
 * tasks (TODO comments), reply, resolve tasks, mark handled locally.
 *
 * Uses the modern get_pull_request_comments API when available and falls
 * back to parsing the PR page HTML on older servers.
 */
export class CommentViewProvider {
    public static readonly viewType = 'rhodecode.comments';

    private panel: vscode.WebviewPanel | undefined;
    private pr: RhodeCodePullRequest | undefined;

    constructor(
        private readonly getClient: () => RhodeCodeClient | undefined,
        private readonly tree: PullRequestTreeProvider,
    ) {}

    async show(pr: RhodeCodePullRequest): Promise<void> {
        this.pr = pr;

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                CommentViewProvider.viewType,
                `RhodeCode #${pr.pull_request_id}`,
                vscode.ViewColumn.One,
                { enableScripts: true, retainContextWhenHidden: true },
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

        try {
            switch (message.type) {
                case 'reply': {
                    if (!message.commentId || !message.text) {
                        return;
                    }
                    await client.commentOnPullRequest(this.pr.pull_request_id, message.text);
                    await this.tree.invalidateComments(this.pr);
                    await this.render();
                    break;
                }
                case 'resolveTask': {
                    if (!message.commentId || !message.text) {
                        return;
                    }
                    await client.resolveTodoComment(this.pr.pull_request_id, message.commentId, message.text);
                    await this.tree.invalidateComments(this.pr);
                    vscode.window.showInformationMessage('Task resolved.');
                    await this.render();
                    break;
                }
                case 'addTask': {
                    if (!message.text) {
                        return;
                    }
                    await client.addTodoComment(this.pr.pull_request_id, message.text);
                    await this.tree.invalidateComments(this.pr);
                    vscode.window.showInformationMessage('Task added.');
                    await this.render();
                    break;
                }
                case 'toggleHandled': {
                    if (!message.commentId) {
                        return;
                    }
                    const handled = this.tree.store.isHandled(repoId, this.pr.pull_request_id, message.commentId);
                    this.tree.store.setHandled(repoId, this.pr.pull_request_id, message.commentId, !handled);
                    if (!handled && getMarkHandledPostsComment()) {
                        await client.commentOnPullRequest(this.pr.pull_request_id, 'Marked as handled ✔');
                    }
                    await this.render();
                    break;
                }
                default:
                    break;
            }
        } catch (err) {
            reportError(message.type, err);
        }
    }

    /** Load comments: modern API first, HTML parse fallback. */
    private async loadComments(client: RhodeCodeClient): Promise<DisplayComment[]> {
        try {
            const apiComments = await client.getPullRequestComments(this.pr!.pull_request_id);
            return apiComments.map((c) => toDisplayComment(c));
        } catch {
            // Older servers lack get_pull_request_comments — fall back to HTML.
            const html = await this.tree.getCommentsHtml(this.pr!);
            const parsed = parsePullRequestComments(html);
            return parsed.map((c) => ({
                id: c.commentId,
                author: c.author,
                date: c.date,
                text: c.text,
                isTodo: c.commentType === 'todo',
                resolved: c.resolved,
                statusLabel: c.statusChange,
                location: null,
            }));
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
        let comments: DisplayComment[];
        let fallback = false;
        try {
            comments = await this.loadComments(client);
        } catch {
            fallback = true;
            comments = [];
        }

        const openTasks = comments.filter((c) => c.isTodo && !c.resolved);
        const summaryParts: string[] = [];
        if (openTasks.length > 0) {
            summaryParts.push(`${openTasks.length} open task${openTasks.length > 1 ? 's' : ''}`);
        }
        if (comments.length > 0) {
            summaryParts.push(`${comments.length} comment${comments.length > 1 ? 's' : ''}`);
        }
        const summary = summaryParts.join(' · ') || 'No comments';

        const rows = comments.map((comment) => this.renderCommentRow(comment, repoId)).join('\n');

        const empty = comments.length === 0 ? '<p class="empty">No comments on this pull request yet.</p>' : '';

        this.panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<style>
body { font-family: var(--vscode-font-family); padding: 1rem; color: var(--vscode-foreground); }
h2 { font-size: 1.1rem; margin-bottom: .3rem; }
.summary { color: var(--vscode-descriptionForeground); font-size: .85rem; margin-bottom: 1rem; }
.comment { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: .6rem .8rem; margin-bottom: .7rem; }
.comment.is-handled { opacity: .55; }
.comment.todo-open { border-left: 3px solid var(--vscode-charts-yellow, #d7a700); }
.comment.todo-done { border-left: 3px solid var(--vscode-charts-green, #4a8f4a); opacity: .7; }
.meta { font-size: .8rem; color: var(--vscode-descriptionForeground); margin-bottom: .35rem; }
.author { font-weight: 600; color: var(--vscode-foreground); }
.date { margin-left: .5rem; }
.badge { display: inline-block; margin-left: .5rem; padding: 0 .35rem; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: .7rem; }
.badge.todo { background: var(--vscode-charts-yellow, #d7a700); color: #1e1e1e; font-weight: 600; }
.badge.resolved { background: var(--vscode-charts-green, #4a8f4a); color: #fff; }
.badge.handled { background: var(--vscode-charts-green, #4a8f4a); color: #fff; }
.location { font-size: .75rem; color: var(--vscode-descriptionForeground); font-style: italic; }
.text { white-space: pre-wrap; margin-top: .25rem; }
.actions { margin-top: .5rem; }
button { margin-right: .5rem; cursor: pointer; }
.topbar { margin-bottom: 1rem; }
.empty { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<h2>#${this.pr.pull_request_id} ${escapeHtml(this.pr.title)}</h2>
<div class="summary">${summary}${fallback ? ' · (older server: parsed from page HTML)' : ''}</div>
<div class="topbar">
  <button id="addTask">+ Add task</button>
  <button id="reply">Reply</button>
</div>
${empty}
${rows}
<script>
(function(){
  const vscode = acquireVsCodeApi();
  function post(type, commentId) {
    let text = null;
    if (type === 'reply' || type === 'resolveTask' || type === 'addTask') {
      text = prompt(type === 'addTask' ? 'New task (TODO comment):' : type === 'resolveTask' ? 'Resolution note (optional):' : 'Reply:');
      if (text === null) return;
      text = text.trim();
      if (!text) return;
    }
    const msg = { type: type };
    if (commentId) msg.commentId = commentId;
    if (text) msg.text = text;
    vscode.postMessage(msg);
  }
  document.getElementById('addTask').addEventListener('click', () => post('addTask'));
  document.getElementById('reply').addEventListener('click', () => post('reply'));
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const commentId = btn.getAttribute('data-comment');
    post(btn.getAttribute('data-action'), commentId);
  });
})();
</script>
</body>
</html>`;
    }

    private renderCommentRow(comment: DisplayComment, repoId: string): string {
        const handled = this.tree.store.isHandled(repoId, this.pr!.pull_request_id, comment.id);

        let cls = 'comment';
        if (comment.isTodo) {
            cls += comment.resolved ? ' todo-done' : ' todo-open';
        }
        if (handled && !comment.isTodo) {
            cls += ' is-handled';
        }

        const typeBadge = comment.isTodo
            ? comment.resolved
                ? '<span class="badge resolved">task · resolved</span>'
                : '<span class="badge todo">TASK</span>'
            : '';
        const handledBadge = handled ? '<span class="badge handled">handled</span>' : '';
        const statusBadge = comment.statusLabel ? `<span class="badge">${escapeHtml(comment.statusLabel)}</span>` : '';
        const location = comment.location ? `<div class="location">${escapeHtml(comment.location)}</div>` : '';

        let actions = '';
        if (comment.isTodo && !comment.resolved) {
            actions += `<button data-action="resolveTask" data-comment="${comment.id}">Resolve task</button>`;
        }
        actions += `<button data-action="reply" data-comment="${comment.id}">Reply</button>`;
        if (!comment.isTodo) {
            actions += `<button data-action="toggleHandled" data-comment="${comment.id}">${handled ? 'Mark unhandled' : 'Mark handled'}</button>`;
        }

        return `
<div class="${cls}">
  <div class="meta">
    <span class="author">${escapeHtml(comment.author || 'unknown')}</span>
    <span class="date">${escapeHtml(comment.date)}</span>
    ${typeBadge}
    ${statusBadge}
    ${handledBadge}
  </div>
  ${location}
  <div class="text">${escapeHtml(comment.text)}</div>
  <div class="actions">${actions}</div>
</div>`;
    }

    dispose(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }
}

function toDisplayComment(c: PullRequestCommentData): DisplayComment {
    const isTodo = c.comment_type === 'todo';
    const resolved = Boolean(c.comment_resolved_by);
    const statusLabel = c.comment_status && 'status_lbl' in c.comment_status ? c.comment_status.status_lbl : null;
    const location = c.comment_f_path ? `${c.comment_f_path}${c.comment_lineno ? ':' + c.comment_lineno : ''}` : null;

    return {
        id: String(c.comment_id),
        author: c.comment_author.full_name_or_username || c.comment_author.username,
        date: c.comment_created_on,
        text: c.comment_text,
        isTodo,
        resolved,
        statusLabel,
        location,
    };
}

async function getRepoIdForStore(): Promise<string> {
    return getRepoIdRaw() ?? '';
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
