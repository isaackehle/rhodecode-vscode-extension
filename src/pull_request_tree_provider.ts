import * as vscode from 'vscode';
import { RhodeCodeClient } from './rhodecode_request';
import { RepoRefs, RhodeCodePullRequest, RepoGroup, RepoInfo } from './model/rhodecode';
import { HandledStore } from './handled_store';
import { setStoredRepo, getStoredRepo } from './repo_state';
import { getCurrentBranch } from './git_remote';

/** Tree item representing a pull request in the RhodeCode view. */
export class PullRequestItem extends vscode.TreeItem {
    constructor(
        public readonly pr: RhodeCodePullRequest,
        public readonly isCurrent: boolean = false,
    ) {
        super(`#${pr.pull_request_id} ${pr.title}`, vscode.TreeItemCollapsibleState.None);
        this.id = `pr-${pr.pull_request_id}`;
        this.contextValue = isCurrent ? 'pullrequest-current' : 'pullrequest';
        this.description = isCurrent ? `🎯 ${pr.status} · ${pr.review_status}` : `${pr.status} · ${pr.review_status}`;
        this.tooltip = (isCurrent ? '🎯 ' : '') + (pr.description || pr.title);
        this.iconPath = isCurrent
            ? new vscode.ThemeIcon('symbol-event', new vscode.ThemeColor('tree.indentGuidesStroke'))
            : new vscode.ThemeIcon(reviewStatusIcon(pr.review_status));
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
        description?: string,
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `section-${sectionId}`;
        this.contextValue = 'section';
        this.iconPath = new vscode.ThemeIcon(icon);
        this.description = description;
    }
}

/** A branch or tag of the configured repository. */
export class RefItem extends vscode.TreeItem {
    constructor(
        public readonly kind: 'branch' | 'tag' | 'closed',
        public readonly name: string,
        public readonly sha: string,
        public readonly isCurrent: boolean = false,
    ) {
        super(name, vscode.TreeItemCollapsibleState.None);
        this.id = `${kind}-${name}`;
        this.contextValue = isCurrent ? `${kind}-current` : kind;
        this.description = isCurrent ? `🎯 ${sha.slice(0, 8)}` : sha.slice(0, 8);
        this.tooltip = `${kind}: ${name}${isCurrent ? ' (current)' : ''}\n${sha}`;
        this.iconPath = isCurrent
            ? new vscode.ThemeIcon('symbol-event', new vscode.ThemeColor('tree.indentGuidesStroke'))
            : new vscode.ThemeIcon(kind === 'tag' ? 'tag' : 'git-branch');
        this.command = {
            command: 'rhodecode.openChangeset',
            title: 'Open in Browser',
            arguments: [sha],
        };
    }
}

/** A group as a folder in the tree view (Issue #19). */
export class GroupItem extends vscode.TreeItem {
    constructor(
        public readonly group: RepoGroup,
        public readonly repoCount: number,
        public readonly isSelected: boolean,
    ) {
        super(group.group_name, vscode.TreeItemCollapsibleState.Expanded);
        this.id = `group-${group.group_id}`;
        this.contextValue = 'group';
        this.description = isSelected ? '🎯' : `${repoCount} repo${repoCount !== 1 ? 's' : ''}`;
        this.tooltip = `Group: ${group.group_name}\n${group.group_description || ''}\n${isSelected ? '🎯 Selected' : `Contains ${repoCount} repository${repoCount !== 1 ? 'ies' : ''}`}`;
        this.iconPath = isSelected
            ? new vscode.ThemeIcon('symbol-event', new vscode.ThemeColor('tree.indentGuidesStroke'))
            : new vscode.ThemeIcon('symbol-folder');
        this.command = {
            command: 'rhodecode.toggleGroup',
            title: 'Toggle Group',
            arguments: [this],
        };
    }
}

/** A repository item in the tree view. */
export class RepoItem extends vscode.TreeItem {
    constructor(public readonly repo: RepoInfo) {
        super(repo.repo_name, vscode.TreeItemCollapsibleState.None);
        this.id = `repo-${repo.repo_id}`;
        this.contextValue = 'repo';
        this.description = repo.repo_type;
        this.tooltip = `Repository: ${repo.repo_name}\nType: ${repo.repo_type}\nClone URI: ${repo.clone_uri || 'N/A'}`;
        this.iconPath = new vscode.ThemeIcon('repo');
        this.command = {
            command: 'rhodecode.selectRepoFromTree',
            title: 'Select Repository',
            arguments: [this],
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

/**
 * Pull Request Tree Provider with two-pane Explorer-style layout (Issue #19).
 *
 * Shows a file-explorer style hierarchy:
 * - Groups as folders (expandable)
 * - Repos as files within their parent group
 * - Pull requests, branches, and tags as separate sections
 */
export class PullRequestTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private pullRequests: RhodeCodePullRequest[] = [];
    private refs: RepoRefs | undefined;
    private _comments: Map<string, string> = new Map(); // prId -> page html
    private groups: RepoGroup[] = [];
    private repos: RepoInfo[] = [];
    private selectedGroups: Set<string> = new Set();
    private currentBranch: string | undefined;

    constructor(
        private readonly getClient: () => RhodeCodeClient | undefined,
        public readonly store: HandledStore,
    ) {}

    refresh(): void {
        this.pullRequests = [];
        this.refs = undefined;
        this._comments.clear();
        this.groups = [];
        this.repos = [];
        this._onDidChangeTreeData.fire();
    }

    /** Update the current branch and repo selection. */
    async updateCurrentBranch(): Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            return;
        }
        this.currentBranch = await getCurrentBranch(folder.uri.fsPath);
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
        // Load groups and repos
        try {
            this.groups = await client.getRepoGroups();
            this.repos = await client.getRepos();
        } catch {
            this.groups = [];
            this.repos = [];
        }
        // Update current branch
        await this.updateCurrentBranch();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
        if (!element) {
            // Unconfigured: return nothing so the viewsWelcome onboarding
            // ("Set up your RhodeCode connection") is shown instead.
            if (!this.getClient()) {
                return [];
            }

            // Check if a repository is selected
            const selectedRepo = getStoredRepo();

            if (!selectedRepo) {
                // No repo selected - show a message to select one
                const selectRepoItem = new vscode.TreeItem(
                    'Select a repository to get started',
                    vscode.TreeItemCollapsibleState.None,
                );
                selectRepoItem.id = 'select-repo';
                selectRepoItem.contextValue = 'select-repo';
                selectRepoItem.description = 'Click to open repository picker';
                selectRepoItem.iconPath = new vscode.ThemeIcon('warning');
                selectRepoItem.command = {
                    command: 'rhodecode.selectRepository',
                    title: 'Select Repository',
                };
                return [selectRepoItem];
            }

            // Build the two-pane tree: groups with repos inside, then PRs/branches/tags
            return this.buildTree();
        }

        if (element instanceof GroupItem) {
            // Show repos belonging to this group
            return this.getReposForGroup(element.group);
        }

        if (element instanceof SectionItem) {
            switch (element.sectionId) {
                case 'pullrequests':
                    return this.getPullRequestItems();
                case 'branches':
                case 'tags':
                case 'bookmarks': {
                    if (element.sectionId === 'branches') {
                        return this.getBranchItems();
                    }
                    if (element.sectionId === 'tags') {
                        const tags = this.refs?.tags ?? {};
                        return Object.entries(tags)
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([name, sha]) => new RefItem('tag', name, sha));
                    }
                    if (element.sectionId === 'bookmarks') {
                        const bookmarks = this.refs?.bookmarks ?? {};
                        return Object.entries(bookmarks)
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([name, sha]) => new RefItem('branch', name, sha));
                    }
                    return [];
                }
                default:
                    return [];
            }
        }
        return [];
    }

    /** Build the tree with groups containing their repos. */
    private buildTree(): vscode.TreeItem[] {
        const items: vscode.TreeItem[] = [];

        // Add groups with their repos (user-accessible only)
        for (const group of this.groups) {
            const groupRepos = this.getReposForGroup(group);
            // Skip groups with no accessible repos
            if (groupRepos.length === 0) {
                continue;
            }
            const isSelected = this.selectedGroups.has(String(group.group_id));
            items.push(new GroupItem(group, groupRepos.length, isSelected));
            // Add repos as children of the group
            items.push(...groupRepos);
        }

        // Add PRs, branches, tags, bookmarks as section headers only
        // Their children are added when the section is expanded
        if (this.pullRequests.length > 0) {
            items.push(new SectionItem('pullrequests', 'Pull Requests', 'git-pull-request'));
        }

        if (this.refs?.branches && Object.keys(this.refs.branches).length > 0) {
            items.push(new SectionItem('branches', 'Branches', 'git-branch'));
        }

        if (this.refs?.tags && Object.keys(this.refs.tags).length > 0) {
            items.push(new SectionItem('tags', 'Tags', 'tag'));
        }

        if (this.refs?.bookmarks && Object.keys(this.refs.bookmarks).length > 0) {
            items.push(new SectionItem('bookmarks', 'Bookmarks', 'star-empty'));
        }

        return items;
    }

    /** Get repos that belong to a specific group. */
    private getReposForGroup(group: RepoGroup): RepoItem[] {
        const groupPath = `${group.group_name}/`;
        const filteredRepos = this.repos.filter((repo) => {
            // Check if repo_name starts with the group path
            return repo.repo_name.startsWith(groupPath);
        });

        return filteredRepos.sort((a, b) => a.repo_name.localeCompare(b.repo_name)).map((repo) => new RepoItem(repo));
    }

    /** Get pull request items with highlighting for current branch's PR. */
    private getPullRequestItems(): vscode.TreeItem[] {
        const items: vscode.TreeItem[] = [];

        // Add a "Create PR" button if current branch has no PR
        if (this.currentBranch && !this.getPRForBranch(this.currentBranch)) {
            const createPRItem = new vscode.TreeItem(
                '$(plus) Create Pull Request',
                vscode.TreeItemCollapsibleState.None,
            );
            createPRItem.id = 'create-pr';
            createPRItem.contextValue = 'create-pr';
            createPRItem.description = `for branch "${this.currentBranch}"`;
            createPRItem.iconPath = new vscode.ThemeIcon('plus');
            createPRItem.tooltip = `No pull request found for branch "${this.currentBranch}".\nClick to create a new pull request.`;
            createPRItem.command = {
                command: 'rhodecode.createPullRequest',
                title: 'Create Pull Request',
                arguments: [this.currentBranch],
            };
            items.push(createPRItem);
        }

        // Add all PRs, marking the current branch's PR as highlighted
        items.push(
            ...this.pullRequests.map((pr) => {
                const isCurrent = !!this.currentBranch && pr.source.reference.name === this.currentBranch;
                return new PullRequestItem(pr, isCurrent);
            }),
        );

        return items;
    }

    /** Get branch items with highlighting for the current branch. */
    private getBranchItems(): vscode.TreeItem[] {
        const branches = this.refs?.branches ?? {};
        return Object.entries(branches)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, sha]) => {
                const isCurrent = name === this.currentBranch;
                return new RefItem('branch', name, sha, isCurrent);
            });
    }

    /** Get the PR for a specific branch, if one exists. */
    private getPRForBranch(branchName: string): RhodeCodePullRequest | undefined {
        return this.pullRequests.find((pr) => pr.source.reference.name === branchName);
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

    /** Select a repository from the tree. */
    selectRepo(repo: RepoInfo): void {
        // This will be called from commands.ts to set the selected repo
        setStoredRepo(repo);
        this._onDidChangeTreeData.fire();
    }

    /** Toggle a group's selection state for filtering repos. */
    toggleGroupSelection(groupId: number): void {
        if (this.selectedGroups.has(String(groupId))) {
            this.selectedGroups.delete(String(groupId));
        } else {
            this.selectedGroups.add(String(groupId));
        }
        this._onDidChangeTreeData.fire();
    }
}
