import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RhodeCodeClient, reportError } from './rhodecoderequest';
import { RepoGroup, RepoInfo } from './model/rhodecode';
import { getServerUrlRaw, getApiKeyRaw } from './configuration';
import { getStoredRepo, setStoredRepo, getRepoIdRaw } from './repoState';

/**
 * Webview panel for browsing and switching RhodeCode repositories (#13).
 *
 * The panel shows:
 *  - The current server URL (with a Connect button if not configured)
 *  - The currently selected repository
 *  - Groups fetched from the server (expandable sections)
 *  - All repositories the user can access
 *
 * Users can switch repositories by clicking on a repo entry, which
 * persists the selection and refreshes the main tree view.
 */
export class RepoBrowserPanel {
    public static current: RepoBrowserPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly disposables: vscode.Disposable[] = [];
    private client: RhodeCodeClient | undefined;
    private groups: RepoGroup[] = [];
    private repos: RepoInfo[] = [];
    private selectedRepoName: string | undefined;
    private searchQuery: string = '';
    private selectedGroups: Set<string> = new Set();

    private constructor(panel: vscode.WebviewPanel) {
        this.panel = panel;
        this.selectedRepoName = getRepoIdRaw();
        this.panel.webview.html = this.getHtmlContent();

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case 'connect':
                        await vscode.commands.executeCommand('rhodecode.connect');
                        break;
                    case 'selectRepo':
                        await this.selectRepo(message.repoName);
                        break;
                    case 'refresh':
                        await this.refresh();
                        break;
                    case 'search':
                        this.searchQuery = message.query || '';
                        this.render();
                        break;
                    case 'toggleGroup':
                        this.toggleGroup(message.groupName);
                        break;
                    case 'filterByGroup':
                        this.toggleGroup(message.groupName);
                        break;
                    case 'clearFilters':
                        this.searchQuery = '';
                        this.selectedGroups.clear();
                        this.render();
                        break;
                    case 'cloneRepo':
                        await this.cloneRepo(message.repoName, message.cloneUri);
                        break;
                }
            },
            undefined,
            this.disposables,
        );

        this.panel.onDidDispose(
            () => {
                RepoBrowserPanel.current = undefined;
            },
            undefined,
            this.disposables,
        );
    }

    /** Create or reveal the repository browser panel. */
    public static createOrShow(context: vscode.ExtensionContext): void {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (RepoBrowserPanel.current) {
            RepoBrowserPanel.current.panel.reveal(column);
            RepoBrowserPanel.current.refresh();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'rhodecodeRepoBrowser',
            'RhodeCode Repositories',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
            },
        );

        context.subscriptions.push(panel);

        RepoBrowserPanel.current = new RepoBrowserPanel(panel);
        RepoBrowserPanel.current.refresh();
    }

    /** Fetch groups and repos from the server and re-render. */
    async refresh() {
        try {
            const serverUrl = getServerUrlRaw();
            if (!serverUrl) {
                this.client = undefined;
                this.groups = [];
                this.repos = [];
                this.render();
                return;
            }

            this.client = await RhodeCodeClient.createForDetection();
            if (!this.client) {
                this.groups = [];
                this.repos = [];
                this.render();
                return;
            }

            // Fetch groups and repos (best-effort: don't fail if either errors)
            try {
                this.groups = await this.client.getRepoGroups();
            } catch {
                this.groups = [];
            }
            try {
                this.repos = await this.client.getRepos();
            } catch {
                this.repos = [];
            }

            this.selectedRepoName = getRepoIdRaw();
            this.render();
        } catch (err) {
            reportError('refresh repo browser', err);
            this.groups = [];
            this.repos = [];
            this.render();
        }
    }

    /** Persist the selected repo and refresh the tree view. */
    private async selectRepo(repoName: string) {
        const repo = this.repos.find((r) => r.repo_name === repoName);
        if (!repo) return;

        await setStoredRepo(repo);
        this.selectedRepoName = repoName;
        await vscode.commands.executeCommand('rhodecode.refresh');
        vscode.window.showInformationMessage(`Switched to repository: ${repo.repo_name}`);
        this.render();
    }

    /** Get the currently selected group (for backward compatibility). */
    private get selectedGroup(): string | null {
        if (this.selectedGroups.size === 0) {
            return null;
        }
        // For backward compatibility, return the first selected group
        return Array.from(this.selectedGroups)[0];
    }

    /** Toggle group selection for multi-filtering. */
    private toggleGroup(groupName: string) {
        if (this.selectedGroups.has(groupName)) {
            this.selectedGroups.delete(groupName);
        } else {
            this.selectedGroups.add(groupName);
        }
        this.render();
    }

    /** Clone a repository to a chosen base folder. */
    private async cloneRepo(repoName: string, cloneUri: string | null) {
        if (!cloneUri) {
            vscode.window.showErrorMessage(`Cannot clone repository: no clone URI available for "${repoName}"`);
            return;
        }

        // Ask for base folder
        const folders = await vscode.window.showOpenDialog({
            openLabel: 'Select Base Folder',
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            title: 'Choose base folder for cloning',
        });

        if (!folders || folders.length === 0) {
            return; // User cancelled
        }

        const baseFolder = folders[0].fsPath;
        const repoFolder = path.join(baseFolder, repoName.split('/').pop() || repoName);

        // Check if folder already exists
        if (fs.existsSync(repoFolder)) {
            const choice = await vscode.window.showWarningMessage(
                `Repository folder already exists at: ${repoFolder}`,
                { modal: true },
                'Cancel',
                'Overwrite',
                'Open Existing',
            );

            if (choice === 'Cancel') {
                return;
            } else if (choice === 'Open Existing') {
                // Open the existing folder
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(repoFolder));
                return;
            } else if (choice === 'Overwrite') {
                // Remove existing folder
                try {
                    fs.rmSync(repoFolder, { recursive: true, force: true });
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    vscode.window.showErrorMessage(`Failed to remove existing folder: ${message}`);
                    return;
                }
            }
        }

        // Clone the repository
        vscode.window.showInformationMessage(`Cloning ${repoName} to ${repoFolder}...`);

        try {
            const { exec } = await import('child_process');
            const util = await import('util');
            const execPromise = util.promisify(exec);

            // Clone the repository
            await execPromise(`git clone "${cloneUri}" "${repoFolder}"`);

            vscode.window.showInformationMessage(`Successfully cloned ${repoName} to ${repoFolder}`);

            // Ask if user wants to open the cloned repository
            const openChoice = await vscode.window.showInformationMessage(
                `Successfully cloned ${repoName}`,
                { modal: false },
                'Open Repository',
                'Done',
            );

            if (openChoice === 'Open Repository') {
                await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(repoFolder));
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to clone repository: ${message}`);
        }
    }

    private render() {
        this.panel.webview.html = this.getHtmlContent();
    }

    /** Escape HTML to prevent injection in dynamic values. */
    private escapeHtml(str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private getHtmlContent(): string {
        const serverUrl = getServerUrlRaw();
        const apiKey = getApiKeyRaw();
        const isConnected = !!serverUrl && !!apiKey;
        const currentRepo = getStoredRepo();

        // Filter repos based on search query and selected groups
        const filteredRepos = this.repos.filter((repo) => {
            // Apply group filter (multi-select)
            if (this.selectedGroups.size > 0) {
                const repoGroup = repo.repo_name.split('/')[0];
                if (!this.selectedGroups.has(repoGroup)) {
                    return false;
                }
            }
            // Apply search filter
            if (this.searchQuery) {
                const query = this.searchQuery.toLowerCase();
                const nameMatch = repo.repo_name?.toLowerCase().includes(query);
                const descMatch = repo.description?.toLowerCase().includes(query);
                const cloneUriMatch = repo.clone_uri?.toLowerCase().includes(query);
                return nameMatch || descMatch || cloneUriMatch;
            }
            return true;
        });

        // Build groups list
        let groupsHtml = '';
        if (this.groups.length > 0) {
            const selectedGroupsLabel = this.selectedGroups.size > 0 ? ` (${this.selectedGroups.size} selected)` : '';
            groupsHtml = `
            <div class="section">
                <h2>Groups (click to filter repositories)${selectedGroupsLabel}</h2>
                <div class="list">
                    ${this.groups
                        .map(
                            (g) => `
                    <div class="list-item group-item ${this.selectedGroups.has(g.group_name) ? 'active' : ''}" onclick="filterByGroup('${this.escapeHtml(g.group_name)}')">
                        <div class="item-name">${this.escapeHtml(g.group_name)}</div>
                        <div class="item-meta">${g.group_description ? this.escapeHtml(g.group_description) : 'No description'}</div>
                    </div>
                    `,
                        )
                        .join('')}
                </div>
            </div>`;
        }

        // Build repos list
        let reposHtml = '';
        if (filteredRepos.length > 0) {
            const totalCount = this.repos.length;
            const displayCount = filteredRepos.length;
            const filterInfo =
                displayCount !== totalCount
                    ? `<span class="filter-info">Showing ${displayCount} of ${totalCount} repositories</span>`
                    : '';

            reposHtml = `
            <div class="section">
                <h2>Repositories ${filterInfo}</h2>
                <div class="list">
                    ${filteredRepos
                        .map((r) => {
                            const isSelected = r.repo_name === this.selectedRepoName;
                            const hasCloneUri = !!r.clone_uri;
                            return `
                    <div class="list-item repo-item ${isSelected ? 'selected' : ''}">
                        <div class="item-content" onclick="selectRepo('${this.escapeHtml(r.repo_name)}')">
                            <div class="item-name">${this.escapeHtml(r.repo_name)}</div>
                            <div class="item-meta">${r.repo_type || ''}${r.clone_uri ? ' · ' + this.escapeHtml(r.clone_uri) : ''}</div>
                        </div>
                        ${hasCloneUri ? `<button class="clone-btn" onclick="event.stopPropagation(); cloneRepo('${this.escapeHtml(r.repo_name)}', '${this.escapeHtml(r.clone_uri || '')}')">Clone</button>` : ''}
                    </div>
                    `;
                        })
                        .join('')}
                </div>
            </div>`;
        } else if (this.repos.length > 0) {
            // No repos match the filter
            reposHtml = `
            <div class="section">
                <h2>Repositories</h2>
                <div class="empty">No repositories match the current filters.</div>
            </div>`;
        }

        return this.buildHtml(
            serverUrl,
            currentRepo,
            isConnected,
            groupsHtml,
            reposHtml,
            this.searchQuery,
            this.selectedGroup,
        );
    }

    private buildHtml(
        serverUrl: string | undefined,
        currentRepo: RepoInfo | undefined,
        isConnected: boolean,
        groupsHtml: string,
        reposHtml: string,
        searchQuery: string,
        selectedGroup: string | null,
    ): string {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RhodeCode Repository Browser</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 10px;
            color: var(--vscode-editorWidget-foreground);
            background-color: var(--vscode-editorWidget-background);
        }
        .section {
            margin-bottom: 20px;
        }
        h2 {
            font-size: 1.1em;
            margin: 0 0 8px 0;
            border-bottom: 1px solid var(--vscode-editorWidget-border);
            padding-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        h2 .filter-info {
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            font-weight: normal;
            border-bottom: none;
        }
        .list {
            display: flex;
            flex-direction: column;
        }
        .list-item {
            padding: 8px 12px;
            border-radius: 4px;
            cursor: pointer;
            margin-bottom: 4px;
        }
        .list-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .list-item.repo-item.selected {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        .list-item.repo-item.selected .item-meta {
            color: var(--vscode-list-activeSelectionForeground);
        }
        .repo-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .item-content {
            flex: 1;
            cursor: pointer;
        }
        .clone-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-secondaryBorder);
            padding: 4px 12px;
            font-size: 0.85em;
            margin-left: 8px;
            white-space: nowrap;
        }
        .clone-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .list-item.group-item {
            border-left: 3px solid transparent;
        }
        .list-item.group-item:hover {
            border-left-color: var(--vscode-list-highlightForeground);
        }
        .list-item.group-item.active {
            background-color: var(--vscode-list-highlightForeground);
            border-left-color: var(--vscode-list-highlightForeground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        .item-name {
            font-size: 0.95em;
            font-weight: 500;
        }
        .item-meta {
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
        .connection-info {
            padding: 10px;
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 4px;
            margin-bottom: 16px;
        }
        .connection-info .server-url {
            font-family: monospace;
            font-size: 0.9em;
            word-break: break-all;
        }
        .connection-info .repo-label {
            margin-top: 4px;
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
        }
        .search-box {
            margin-bottom: 16px;
        }
        .search-box input {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 0.9em;
            box-sizing: border-box;
        }
        .search-box input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .search-box input::placeholder {
            color: var(--vscode-descriptionForeground);
        }
        .clear-filters-btn {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 10px;
            font-size: 0.8em;
            margin-left: auto;
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }
        .empty {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 8px 0;
        }
    </style>
    <script>
        const vscode = acquireVsCodeApi();
        function selectRepo(repoName) {
            vscode.postMessage({ type: 'selectRepo', repoName });
        }
        function refresh() {
            vscode.postMessage({ type: 'refresh' });
        }
        function connect() {
            vscode.postMessage({ type: 'connect' });
        }
        function filterByGroup(groupName) {
            vscode.postMessage({ type: 'filterByGroup', groupName });
        }
        function clearFilters() {
            vscode.postMessage({ type: 'clearFilters' });
        }
        function cloneRepo(repoName, cloneUri) {
            vscode.postMessage({ type: 'cloneRepo', repoName, cloneUri });
        }
        document.addEventListener('DOMContentLoaded', function() {
            const searchInput = document.getElementById('repo-search');
            if (searchInput) {
                searchInput.addEventListener('input', function(e) {
                    vscode.postMessage({ type: 'search', query: e.target.value });
                });
            }
        });
    </script>
</head>
<body>
    <div class="connection-info">
        <div class="server-url">${serverUrl || '(not connected)'}</div>
        <div class="repo-label">Current repository: ${currentRepo?.repo_name || '(none selected)'}</div>
        <div class="actions">
            ${isConnected ? `<button onclick="refresh()">Refresh</button>` : `<button onclick="connect()">Connect to RhodeCode</button>`}
            ${searchQuery || selectedGroup ? `<button onclick="clearFilters()" class="clear-filters-btn">Clear filters</button>` : ''}
        </div>
    </div>
    ${
        isConnected
            ? `
        <div class="search-box">
            <input
                type="text"
                id="repo-search"
                placeholder="Search repositories..."
                value="${this.escapeHtml(searchQuery)}"
            />
        </div>
        `
            : ''
    }
    ${isConnected ? groupsHtml + reposHtml : '<div class="empty">Connect to RhodeCode to browse repositories.</div>'}
</body>
</html>
        `;
    }

    public dispose() {
        RepoBrowserPanel.current = undefined;
        this.panel.dispose();
    }
}
