import * as vscode from 'vscode';

const CONFIGURATION_SECTION = 'rhodecode';

export async function getApiKey(): Promise<string | undefined> {
    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);

    let apiKey = configuration.get<string>('apikey');
    if (!apiKey) {
        apiKey = await vscode.window.showInputBox({
            placeHolder: 'API Key',
            prompt: 'Please enter your RhodeCode API key'
        });
        if (apiKey) {
            await configuration.update('apikey', apiKey, vscode.ConfigurationTarget.Global);
        }
    }
    return apiKey;
}

export async function getApiUrl(): Promise<string | undefined> {
    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);

    let serverUrl = configuration.get<string>('serverurl');
    if (!serverUrl) {
        serverUrl = await vscode.window.showInputBox({
            placeHolder: 'Server URL',
            prompt: 'Please enter your RhodeCode server URL'
        });
        if (serverUrl) {
            await configuration.update('serverurl', serverUrl, vscode.ConfigurationTarget.Global);
        }
    }

    if (serverUrl) {
        if (!/^https?:\/\//i.test(serverUrl)) {
            serverUrl = 'https://' + serverUrl;
        }
        serverUrl = serverUrl.replace(/\/+$/, '');
    }
    return serverUrl;
}

export async function getRepoId(): Promise<string | undefined> {
    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);

    let repoId = configuration.get<string>('repoid');
    if (!repoId) {
        repoId = await vscode.window.showInputBox({
            placeHolder: 'Repository Identifier',
            prompt: 'Please enter the repository identifier. This will be saved in your workspace configuration'
        });
        if (repoId) {
            await configuration.update('repoid', repoId, vscode.ConfigurationTarget.Workspace);
        }
    }
    return repoId;
}

export function getMarkHandledPostsComment(): boolean {
    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
    return configuration.get<boolean>('markHandledPostsComment', false);
}

/* ------------------------------------------------------------------ */
/* Non-prompting accessors used by the connection wizard              */
/* ------------------------------------------------------------------ */

export function getServerUrlRaw(): string | undefined {
    return vscode.workspace.getConfiguration(CONFIGURATION_SECTION).get<string>('serverurl');
}

export function getApiKeyRaw(): string | undefined {
    return vscode.workspace.getConfiguration(CONFIGURATION_SECTION).get<string>('apikey');
}

export function getRepoIdRaw(): string | undefined {
    return vscode.workspace.getConfiguration(CONFIGURATION_SECTION).get<string>('repoid');
}

export async function setServerUrl(value: string): Promise<void> {
    await vscode.workspace
        .getConfiguration(CONFIGURATION_SECTION)
        .update('serverurl', value, vscode.ConfigurationTarget.Global);
}

export async function setApiKey(value: string): Promise<void> {
    await vscode.workspace
        .getConfiguration(CONFIGURATION_SECTION)
        .update('apikey', value, vscode.ConfigurationTarget.Global);
}

/** Save the selected repository identifier to workspace settings. */
export async function setRepoId(value: string): Promise<void> {
    await vscode.workspace
        .getConfiguration(CONFIGURATION_SECTION)
        .update('repoid', value, vscode.ConfigurationTarget.Workspace);
}

/**
 * Normalize + validate a server address. Returns the normalized URL or
 * an error message string. Accepts "host", "host:port", "https://host/…";
 * bare hosts get https:// prepended.
 */
export function normalizeServerUrl(input: string): { url: string } | { error: string } {
    let raw = input.trim();
    if (!raw) {
        return { error: 'Server address is empty.' };
    }
    if (!/^https?:\/\//i.test(raw)) {
        raw = 'https://' + raw;
    }
    raw = raw.replace(/\/+$/, '');
    const m = raw.match(/^https?:\/\/([^/]+)/i);
    if (!m) {
        return { error: 'Could not parse a host from that address.' };
    }
    const host = m[1];
    if (!host || /\s/.test(host)) {
        return { error: 'The server address must not contain spaces.' };
    }
    if (!/^[a-zA-Z0-9.-]+(:\d+)?$/.test(host) && !/^\[[0-9a-fA-F:]+\](:\d+)?$/.test(host)) {
        return { error: `"${host}" does not look like a host name or IP address.` };
    }
    if (raw.includes('://') && !/^https?:\/\//i.test(raw)) {
        return { error: 'Only http:// and https:// are supported.' };
    }
    return { url: raw };
}
