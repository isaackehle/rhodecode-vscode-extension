import * as vscode from 'vscode';
import { RhodeCodeClient } from './rhodecoderequest';
import { RepoGroup, RepoInfo } from './model/rhodecode';
import { normalizeServerUrl } from './configuration';

/**
 * Connection wizard:
 *   1. server address (format validated)
 *   2. API key
 *   3. connection verified against the server (fresh client from the
 *      entered values, so re-running the wizard picks up changes)
 *   4. browse groups/repos (type to filter) and pick one
 * Caller persists the values and refreshes the tree.
 */
export async function setupConnection(): Promise<
    { client: RhodeCodeClient; repo: RepoInfo; serverUrl: string; apiKey: string } | undefined
> {
    const serverUrl = await promptServerUrl();
    if (serverUrl === undefined) {
        return undefined;
    }
    const apiKey = await promptApiKey();
    if (apiKey === undefined) {
        return undefined;
    }

    const client = new RhodeCodeClient(serverUrl, apiKey, '');

    // Verify the connection before offering any repos.
    try {
        const groups = await client.getRepoGroups();
        vscode.window.showInformationMessage(
            `Connected to ${client.getServerUrl()} (${groups.length} accessible group${groups.length === 1 ? '' : 's'}).`
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`RhodeCode: could not connect — ${message}`);
        return undefined;
    }

    const repo = await browseRepositories(client);
    if (!repo) {
        return undefined;
    }

    // Rebuild the client with the chosen repository wired in.
    const finalClient = new RhodeCodeClient(serverUrl, apiKey, repo.repo_name);

    return { client: finalClient, repo, serverUrl, apiKey };
}

/** Browse groups and repositories with a drill-down quick pick. */
export async function browseRepositories(client: RhodeCodeClient): Promise<RepoInfo | undefined> {
    let groups: RepoGroup[];
    let repos: RepoInfo[];
    try {
        [groups, repos] = await Promise.all([client.getRepoGroups(), client.getRepos()]);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`RhodeCode: could not list repositories — ${message}`);
        return undefined;
    }

    if (repos.length === 0 && groups.length === 0) {
        vscode.window.showInformationMessage('No repository groups or repositories are accessible to you on this server.');
        return undefined;
    }

    // Navigation is a path prefix, e.g. "" (root) or "team/services".
    let current = '';
    const goUp = (path: string): string => {
        const idx = path.lastIndexOf('/');
        return idx === -1 ? '' : path.slice(0, idx);
    };

    // Collect a repo (flat result) and let the caller save it.
    let chosen: RepoInfo | undefined;
    let done = false;

    while (!done) {
        const prefix = current ? current + '/' : '';
        const subGroups = groups
            .filter((g) => (g.parent_group ?? '') === current)
            .sort((a, b) => a.group_name.localeCompare(b.group_name));
        const localRepos = repos
            .filter((r) => r.repo_name.startsWith(prefix) && r.repo_name.slice(prefix.length).split('/').length === 1)
            .sort((a, b) => a.repo_name.localeCompare(b.repo_name));

        const items: vscode.QuickPickItem[] = [];
        if (current) {
            items.push({ label: '$(arrow-up)  up one level', description: goUp(current) || '(root)' });
        }
        for (const g of subGroups) {
            items.push({
                label: `$(folder)  ${g.group_name.split('/').pop()}`,
                description: 'group',
                detail: g.group_description || undefined
            });
        }
        for (const r of localRepos) {
            items.push({
                label: `$(repo)  ${r.repo_name.split('/').pop()}`,
                description: r.repo_type,
                detail: r.description || undefined
            });
        }

        const placeHolder = current
            ? `In ${current} — type to filter, pick a group to go deeper or a repository to use it`
            : 'Pick a group or repository — type to filter';

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder,
            matchOnDescription: true,
            matchOnDetail: true,
            ignoreFocusOut: true
        });

        if (!picked) {
            done = true; // cancelled
            continue;
        }
        if (picked.label.startsWith('$(arrow-up)')) {
            current = goUp(current);
            continue;
        }
        if (picked.label.startsWith('$(folder)')) {
            const name = picked.label.replace(/^\$\(folder\)\s+/, '');
            current = prefix + name;
            continue;
        }
        // Repository selected
        const name = picked.label.replace(/^\$\(repo\)\s+/, '');
        chosen = repos.find((r) => r.repo_name.split('/').pop() === name && r.repo_name.startsWith(prefix))!;
        done = true;
    }

    return chosen;
}

export async function promptServerUrl(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('rhodecode');
    const current = config.get<string>('serverurl', '');
    const input = await vscode.window.showInputBox({
        prompt: 'RhodeCode server address (e.g. rhodecode.example.com or https://rhodecode.example.com:8443)',
        placeHolder: 'https://rhodecode.example.com',
        value: current,
        ignoreFocusOut: true
    });
    if (input === undefined) {
        return undefined; // cancelled
    }
    const result = normalizeServerUrl(input);
    if ('error' in result) {
        vscode.window.showErrorMessage(`RhodeCode: ${result.error}`);
        return undefined;
    }
    return result.url;
}

export async function promptApiKey(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('rhodecode');
    const current = config.get<string>('apikey', '');
    const input = await vscode.window.showInputBox({
        prompt: 'RhodeCode API key (found in your user profile on the server)',
        placeHolder: 'pasted-api-key',
        value: current,
        password: true,
        ignoreFocusOut: true
    });
    if (input === undefined) {
        return undefined;
    }
    const key = input.trim();
    if (!key) {
        vscode.window.showErrorMessage('RhodeCode: API key must not be empty.');
        return undefined;
    }
    return key;
}
