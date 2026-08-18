import * as vscode from 'vscode';
import { getApiKeyFromEnv } from './envfile';

const CONFIGURATION_SECTION = 'rhodecode';

/** Whether the API key should be read from a .env file (rhodecode.apikeyFromEnv). */
export function isApiKeyFromEnvEnabled(): boolean {
    return vscode.workspace.getConfiguration(CONFIGURATION_SECTION).get<boolean>('apikeyFromEnv', false);
}

/**
 * Whether marking a comment as handled should also post a reply comment to
 * the PR thread (rhodecode.markHandledPostsComment).
 * When false, handled state is tracked locally only.
 */
export function isMarkHandledPostsCommentEnabled(): boolean {
    return vscode.workspace.getConfiguration(CONFIGURATION_SECTION).get<boolean>('markHandledPostsComment', false);
}

export async function getApiKey(): Promise<string | undefined> {
    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION);

    // Env-file mode is opt-in: when enabled, RHODECODE_API_KEY comes from
    // .env (workspace, then ~/.env) and the rhodecode.apikey setting is ignored.
    if (isApiKeyFromEnvEnabled()) {
        const envKey = getApiKeyFromEnv();
        if (envKey) {
            return envKey;
        }
        vscode.window.showErrorMessage(
            'RhodeCode: rhodecode.apikeyFromEnv is enabled, but RHODECODE_API_KEY was not found in a .env file ' +
                '(checked workspace .env, then ~/.env).',
        );
        return undefined;
    }

    let apiKey = configuration.get<string>('apikey');
    if (!apiKey) {
        apiKey = await vscode.window.showInputBox({
            placeHolder: 'API Key',
            prompt: 'Please enter your RhodeCode API key',
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
            prompt: 'Please enter your RhodeCode server URL',
        });
        if (serverUrl) {
            await configuration.update('serverurl', serverUrl, vscode.ConfigurationTarget.Global);
        }
    }

    if (serverUrl) {
        if (!serverUrl.match(/^https?:\/\//i)) {
            serverUrl = 'https://' + serverUrl;
        }
        serverUrl = serverUrl.replace(/\/+$/, '');
    }
    return serverUrl;
}

/* ------------------------------------------------------------------ */
/* Non-prompting accessors used by the connection wizard              */
/* ------------------------------------------------------------------ */

export function getServerUrlRaw(): string | undefined {
    return vscode.workspace.getConfiguration(CONFIGURATION_SECTION).get<string>('serverurl');
}

export function getApiKeyRaw(): string | undefined {
    if (isApiKeyFromEnvEnabled()) {
        return getApiKeyFromEnv();
    }
    return vscode.workspace.getConfiguration(CONFIGURATION_SECTION).get<string>('apikey');
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
    if (!raw.match(/^https?:\/\//i)) {
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
    if (raw.includes('://') && !raw.match(/^https?:\/\//i)) {
        return { error: 'Only http:// and https:// are supported.' };
    }
    return { url: raw };
}

/**
 * Extract just the host portion from a server URL (without protocol or path).
 * Used for cleaner status bar display (issue #18).
 * Example: "https://xxx.yyyy.com:5443" -> "xxx.yyyy.com:5443"
 */
export function extractServerHostFromUrl(url: string): string | undefined {
    if (!url) {
        return undefined;
    }
    const m = url.match(/^https?:\/\/([^/]+)/i);
    return m ? m[1] : undefined;
}
