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
