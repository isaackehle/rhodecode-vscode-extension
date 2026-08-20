import * as vscode from 'vscode';
import { logDebug } from './extension';
import { getCurrentBranch } from './git_remote';
import { HandledStore } from './handled_store';
import { RepoGroup, RepoInfo, RepoRefs, RhodeCodePullRequest } from './model/rhodecode';
import { getStoredRepo, setStoredRepo } from './repo_state';
import { RhodeCodeClient } from './rhodecode_request';

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
            ? new vscode.ThemeIcon('target')
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
        this.description = sha.slice(0, 8);
        this.tooltip = `${kind}: ${name}${isCurrent ? ' (current)' : ''}\n${sha}`;
        this.iconPath = isCurrent
            ? new vscode.ThemeIcon('target')
            : new vscode.ThemeIcon(kind === 'tag' ? 'tag' : 'git-branch');
        // Set command based on kind
        if (kind === 'branch') {
            // Keep switch branch command, add PR creation as a secondary action in tooltip
            this.tooltip += '\n$(plus) Click to create PR';
            this.command = {
                command: 'rhodecode.switchBranch',
                title: 'Switch to Branch',
                arguments: [this],
            };
        } else {
            this.command = {
                command: 'rhodecode.switchTag',
                title: 'Switch to Tag',
                arguments: [this],
            };
        }
    }
}

/** A collapsible node for the Branches section. */
export class BranchesSectionItem extends vscode.TreeItem {
    constructor(public readonly sectionId: string) {
        super('Branches', vscode.TreeItemCollapsibleState.Expanded);
        this.id = `section-${sectionId}`;
        this.contextValue = 'section';
        this.iconPath = new vscode.ThemeIcon('git-branch');
        this.description = 'branches + bookmarks';
    }
}

/** A group as a folder in the tree view (Issue #19). */
export class GroupItem extends vscode.TreeItem {
    constructor(
        public readonly group: RepoGroup,
        public readonly repoCount: number,
        public readonly isSelected: boolean,
        public readonly displayName: string = group.group_name,
    ) {
        super(displayName, vscode.TreeItemCollapsibleState.Expanded);
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

/** Internal tree node for building group hierarchy. */
class GroupNode {
    constructor(
        public readonly group: RepoGroup,
        public readonly displayName: string,
        public parent: GroupNode | null = null,
    ) {}

    children: GroupNode[] = [];
    repos: RepoItem[] = [];
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
        const oldBranch = this.currentBranch;
        this.currentBranch = await getCurrentBranch(folder.uri.fsPath);
        if (oldBranch !== this.currentBranch) {
            logDebug(`Branch update: "${oldBranch ?? 'none'}" -> "${this.currentBranch ?? 'none'}"`);
        }
        this._onDidChangeTreeData.fire();
    }

    async load(): Promise<void> {
        const client = this.getClient();
        if (!client) {
            return;
        }
        try {
            this.pullRequests = await client.getPullRequests();
        } catch (err) {
            logDebug(`Failed to load pull requests: ${err instanceof Error ? err.message : String(err)}`);
            this.pullRequests = [];
        }
        // Refs are best-effort: PR listing should not fail because of them.
        try {
            this.refs = await client.getRepoRefs();
        } catch {
            logDebug('Failed to load branches and tags');
            this.refs = undefined;
        }
        // Load groups and repos
        try {
            this.groups = await client.getRepoGroups();
            this.repos = await client.getRepos();
        } catch (err) {
            logDebug(`Failed to load groups and repos: ${err instanceof Error ? err.message : String(err)}`);
            this.groups = [];
            this.repos = [];
        }
        // Update current branch
        await this.updateCurrentBranch();
        // Force complete tree refresh
        this._onDidChangeTreeData.fire(undefined);
        logDebug('load() complete, tree refreshed');
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

        if (element instanceof SectionItem || element instanceof BranchesSectionItem) {
            switch (element.sectionId) {
                case 'pullrequests':
                    return this.getPullRequestItems();
                case 'branches': {
                    // Return combined branches and bookmarks under the Branches section
                    return this.getBranchItems();
                }
                case 'tags': {
                    const tags = this.refs?.tags ?? {};
                    return Object.entries(tags)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([name, sha]) => new RefItem('tag', name, sha));
                }
                case 'bookmarks': {
                    const bookmarks = this.refs?.bookmarks ?? {};
                    return Object.entries(bookmarks)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([name, sha]) => new RefItem('branch', name, sha));
                }
                case 'groups': {
                    // Build hierarchical group structure
                    const rootNodes = this.buildGroupHierarchy();
                    const items: vscode.TreeItem[] = [];
                    for (const node of rootNodes) {
                        items.push(...this.renderGroupNode(node));
                    }
                    return items;
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

        logDebug('buildTree(): Starting to build tree');

        // Add PRs, branches, tags, bookmarks as section headers only
        // Their children are added when the section is expanded
        if (this.pullRequests.length > 0) {
            items.push(new SectionItem('pullrequests', 'Pull Requests', 'git-pull-request'));
            logDebug('buildTree(): Added Pull Requests section');
        }

        if (this.refs?.branches && Object.keys(this.refs.branches).length > 0) {
            items.push(new BranchesSectionItem('branches'));
            logDebug('buildTree(): Added Branches section');
        }

        if (this.refs?.tags && Object.keys(this.refs.tags).length > 0) {
            items.push(new SectionItem('tags', 'Tags', 'tag'));
            logDebug('buildTree(): Added Tags section');
        }

        if (this.refs?.bookmarks && Object.keys(this.refs.bookmarks).length > 0) {
            items.push(new SectionItem('bookmarks', 'Bookmarks', 'star-empty'));
            logDebug('buildTree(): Added Bookmarks section');
        }

        // Add groups as a section header only - children are added when expanded
        const groupsWithRepos = this.groups.filter((group) => {
            const groupRepos = this.getReposForGroup(group);
            return groupRepos.length > 0;
        });

        if (groupsWithRepos.length > 0) {
            items.push(new SectionItem('groups', 'Groups', 'symbol-folder'));
            logDebug('buildTree(): Added Groups section header');
        }

        logDebug(`buildTree(): Returning ${items.length} top-level items`);
        return items;
    }

    /** Build hierarchical group structure from flat group list. */
    private buildGroupHierarchy(): GroupNode[] {
        // Create nodes for all groups
        const groupMap = new Map<string, GroupNode>();
        for (const group of this.groups) {
            const parts = group.group_name.split('/');
            const displayName = parts[parts.length - 1];
            const node = new GroupNode(group, displayName);
            groupMap.set(group.group_name, node);
            logDebug(`buildGroupHierarchy: Created node "${displayName}" for "${group.group_name}"`);
        }

        // Link parent-child relationships
        for (const [groupName, node] of groupMap) {
            const parts = groupName.split('/');
            if (parts.length > 1) {
                const parentName = parts.slice(0, -1).join('/');
                const parentNode = groupMap.get(parentName);
                if (parentNode) {
                    parentNode.children.push(node);
                    node.parent = parentNode;
                }
            }
        }

        // Collect repos for each group
        for (const node of groupMap.values()) {
            const groupPath = `${node.group.group_name}/`;
            const groupRepos = this.repos.filter((repo) => repo.repo_name.startsWith(groupPath));
            for (const repo of groupRepos) {
                // Flatten repo name by removing the group path prefix
                const relativeName = repo.repo_name.substring(groupPath.length);
                const repoWithFlattenedName = new RepoItem({
                    ...repo,
                    repo_name: relativeName,
                });
                node.repos.push(repoWithFlattenedName);
            }
        }

        // Return root nodes (groups with no parent or parent doesn't exist)
        const rootNodes: GroupNode[] = [];
        for (const node of groupMap.values()) {
            if (!node.parent || !groupMap.has(node.parent.group.group_name)) {
                rootNodes.push(node);
            }
        }

        return rootNodes.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

    /** Render a group node and its children recursively. */
    private renderGroupNode(node: GroupNode): vscode.TreeItem[] {
        const items: vscode.TreeItem[] = [];

        // Count repos for this group level only (not including children)
        const totalRepos = node.repos.length;
        const isSelected = this.selectedGroups.has(String(node.group.group_id));

        // Add group item - always use leaf displayName
        const groupItem = new GroupItem(node.group, totalRepos, isSelected, node.displayName);
        items.push(groupItem);

        // Add repos directly under this group (only this level, not children)
        if (node.repos.length > 0) {
            // Sort repos alphabetically by their (flattened) name
            const sortedRepos = node.repos.sort((a, b) => a.repo.repo_name.localeCompare(b.repo.repo_name));
            items.push(...sortedRepos);
        }

        // Recursively add child groups and their repos
        const sortedChildren = node.children.sort((a, b) => a.displayName.localeCompare(b.displayName));
        for (const child of sortedChildren) {
            items.push(...this.renderGroupNode(child));
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
            const createPRItem = new vscode.TreeItem('Create Pull Request', vscode.TreeItemCollapsibleState.None);
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
    public getPRForBranch(branchName: string): RhodeCodePullRequest | undefined {
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
