import * as vscode from 'vscode';
import { RhodeCodeClient } from './rhodecoderequest';
import { RepoRefs, RhodeCodePullRequest } from './model/rhodecode';
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
            arguments: [this],
        };
    }
}

/** Section header (Pull Requests / Branches / Tags). */
export class SectionItem extends vscode.TreeItem {
    constructor(
        public readonly sectionId: string,
        label: string,
        icon: string,
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `section-${sectionId}`;
        this.contextValue = 'section';
        this.iconPath = new vscode.ThemeIcon(icon);
    }
}

/** A branch or tag of the configured repository. */
export class RefItem extends vscode.TreeItem {
    constructor(
        public readonly kind: 'branch' | 'tag' | 'closed',
        public readonly name: string,
        public readonly sha: string,
    ) {
        super(name, vscode.TreeItemCollapsibleState.None);
        this.id = `${kind}-${name}`;
        this.contextValue = kind;
        this.description = sha.slice(0, 8);
        this.tooltip = `${kind}: ${name}\n${sha}`;
        this.iconPath = new vscode.ThemeIcon(kind === 'tag' ? 'tag' : 'git-branch');
        this.command = {
            command: 'rhodecode.openChangeset',
            title: 'Open in Browser',
            arguments: [sha],
        };
    }
}

/** Placeholder shown when no server/repository is configured yet. */
export class SetupItem extends vscode.TreeItem {
    constructor() {
        super('Set up connection…', vscode.TreeItemCollapsibleState.None);
        this.id = 'setup';
        this.contextValue = 'setup';
        this.iconPath = new vscode.ThemeIcon('plug');
        this.command = {
            command: 'rhodecode.connect',
            title: 'Connect to RhodeCode',
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

export class PullRequestTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private pullRequests: RhodeCodePullRequest[] = [];
    private refs: RepoRefs | undefined;
    private _comments: Map<string, string> = new Map(); // prId -> page html

    constructor(
        private readonly getClient: () => RhodeCodeClient | undefined,
        public readonly store: HandledStore,
    ) {}

    refresh(): void {
        this.pullRequests = [];
        this.refs = undefined;
        this._comments.clear();
        this._onDidChangeTreeData.fire();
    }

    async load(): Promise<void> {
        const client = this.getClient();
        if (!client) {
            return;
        }
        this.pullRequests = await client.getPullRequests();
        // Refs are best-effort: PR listing should not fail because of them.
        try {
            this.refs = await client.getRepoRefs();
        } catch {
            this.refs = undefined;
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
        if (!element) {
            if (!this.getClient()) {
                return [new SetupItem()];
            }
            return [
                new SectionItem('pullrequests', 'Pull Requests', 'git-pull-request'),
                new SectionItem('branches', 'Branches', 'git-branch'),
                new SectionItem('tags', 'Tags', 'tag'),
            ];
        }

        if (element instanceof SectionItem) {
            switch (element.sectionId) {
                case 'pullrequests':
                    return this.pullRequests.map((pr) => new PullRequestItem(pr));
                case 'branches': {
                    const branches = this.refs?.branches ?? {};
                    return Object.entries(branches)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([name, sha]) => new RefItem('branch', name, sha));
                }
                case 'tags': {
                    const tags = this.refs?.tags ?? {};
                    return Object.entries(tags)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([name, sha]) => new RefItem('tag', name, sha));
                }
                default:
                    return [];
            }
        }
        return [];
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
