import * as vscode from 'vscode';
import { RhodeCodeClient } from './rhodecoderequest';
import { RepoRefs, RhodeCodePullRequest, RepoGroup, RepoInfo } from './model/rhodecode';
import { HandledStore } from './handledStore';
import { setStoredRepo, getStoredRepo } from './repoState';

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

/** A group header in the groups pane. */
export class GroupItem extends vscode.TreeItem {
    constructor(
        public readonly group: RepoGroup,
        public readonly isSelected: boolean,
    ) {
        super(group.group_name, vscode.TreeItemCollapsibleState.None);
        this.id = `group-${group.group_id}`;
        this.contextValue = 'group';
        this.description = isSelected ? '✓' : '';
        this.tooltip = `Group: ${group.group_name}\n${group.group_description || ''}\n${isSelected ? '✓ Selected (multi-filter)' : 'Click to filter repos'}`;
        this.iconPath = isSelected ? new vscode.ThemeIcon('check') : new vscode.ThemeIcon('symbol-folder');
        this.command = {
            command: 'rhodecode.toggleGroup',
            title: 'Toggle Group',
            arguments: [this],
        };
    }
}

/** A repository item in the repos pane. */
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

export class PullRequestTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private pullRequests: RhodeCodePullRequest[] = [];
    private refs: RepoRefs | undefined;
    private _comments: Map<string, string> = new Map(); // prId -> page html
    private groups: RepoGroup[] = [];
    private repos: RepoInfo[] = [];
    private selectedGroups: Set<string> = new Set();

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
        this.selectedGroups.clear();
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
        // Load groups and repos for the left panel
        try {
            [this.groups, this.repos] = await Promise.all([client.getRepoGroups(), client.getRepos()]);
        } catch {
            this.groups = [];
            this.repos = [];
        }
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

            // Repo is selected - show all sections
            return [
                new SectionItem('groups', 'Groups', 'symbol-folder', 'Click to filter repositories'),
                new SectionItem(
                    'repos',
                    'Repositories',
                    'repo',
                    this.selectedGroups.size > 0
                        ? `Filtered by ${this.selectedGroups.size} group${this.selectedGroups.size > 1 ? 's' : ''}`
                        : 'All repositories',
                ),
                new SectionItem('pullrequests', 'Pull Requests', 'git-pull-request'),
                new SectionItem('branches', 'Branches', 'git-branch'),
                new SectionItem('tags', 'Tags', 'tag'),
            ];
        }

        if (element instanceof SectionItem) {
            switch (element.sectionId) {
                case 'groups':
                    return this.groups
                        .sort((a, b) => a.group_name.localeCompare(b.group_name))
                        .map((group) => new GroupItem(group, this.selectedGroups.has(String(group.group_id))));
                case 'repos': {
                    // Filter repos based on selected groups
                    let filteredRepos = this.repos;
                    if (this.selectedGroups.size > 0) {
                        // Filter by matching repo_name path prefix with group names
                        // e.g., repo_name "team/services/api" matches groups "team", "team/services"
                        filteredRepos = this.repos.filter((repo) => {
                            const repoNameParts = repo.repo_name.split('/');
                            for (let i = 0; i < repoNameParts.length; i++) {
                                const groupPath = repoNameParts.slice(0, i + 1).join('/');
                                if (this.selectedGroups.has(groupPath)) {
                                    return true;
                                }
                            }
                            return false;
                        });
                    }
                    return filteredRepos
                        .sort((a, b) => a.repo_name.localeCompare(b.repo_name))
                        .map((repo) => new RepoItem(repo));
                }
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

    /** Toggle a group's selection state for filtering repos. */
    toggleGroupSelection(groupId: number): void {
        if (this.selectedGroups.has(String(groupId))) {
            this.selectedGroups.delete(String(groupId));
        } else {
            this.selectedGroups.add(String(groupId));
        }
        this._onDidChangeTreeData.fire();
    }

    /** Select a repository from the tree. */
    selectRepo(repo: RepoInfo): void {
        // This will be called from commands.ts to set the selected repo
        setStoredRepo(repo);
        this._onDidChangeTreeData.fire();
    }
}
