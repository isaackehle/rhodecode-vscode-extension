import * as vscode from 'vscode';
import { RhodeCodeClient } from './rhodecoderequest';
import { RhodeCodePullRequest } from './model/rhodecode';
import { HandledStore } from './handledStore';

/** Tree item representing a pull request in the RhodeCode view. */
export class PullRequestItem extends vscode.TreeItem {
    constructor(public readonly pr: RhodeCodePullRequest) {
        super(`#${pr.pull_request_id} ${pr.title}`, vscode.TreeItemCollapsibleState.None);
        this.id = `pr-${pr.pull_request_id}`;
        this.contextValue = 'pullrequest';
        this.description = `${pr.status} · ${pr.review_status}`;
        this.tooltip = pr.description || pr.title;
        this.iconPath = new vscode.ThemeIcon(reviewStatusIcon(pr.review_status));
        this.command = {
            command: 'rhodecode.showComments',
            title: 'Show Comments',
            arguments: [this]
        };
    }
}

function reviewStatusIcon(status: string): string {
    switch (status) {
        case 'approved':
            return 'check';
        case 'rejected':
            return 'error';
        case 'under_review':
            return 'eye';
        default:
            return 'git-pull-request';
    }
}

export class PullRequestTreeProvider implements vscode.TreeDataProvider<PullRequestItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<PullRequestItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private pullRequests: RhodeCodePullRequest[] = [];
    private _comments: Map<string, string> = new Map(); // prId -> page html

    constructor(
        private readonly getClient: () => RhodeCodeClient | undefined,
        public readonly store: HandledStore
    ) {}

    refresh(): void {
        this.pullRequests = [];
        this._comments.clear();
        this._onDidChangeTreeData.fire();
    }

    async load(): Promise<void> {
        const client = this.getClient();
        if (!client) {
            return;
        }
        this.pullRequests = await client.getPullRequests();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: PullRequestItem): vscode.TreeItem {
        return element;
    }

    getChildren(): PullRequestItem[] {
        return this.pullRequests.map((pr) => new PullRequestItem(pr));
    }

    /** Fetch (and cache) the PR page HTML used to parse the comment thread. */
    async getCommentsHtml(pr: RhodeCodePullRequest): Promise<string> {
        const client = this.getClient();
        if (!client) {
            throw new Error('RhodeCode is not configured');
        }
        const id = String(pr.pull_request_id);
        if (!this._comments.has(id)) {
            this._comments.set(id, await client.getPullRequestPage(id));
        }
        return this._comments.get(id)!;
    }

    /** Re-fetch a PR's comment page (used after replying/marking handled). */
    async invalidateComments(pr: RhodeCodePullRequest): Promise<void> {
        this._comments.delete(String(pr.pull_request_id));
        await this.getCommentsHtml(pr);
    }
}
