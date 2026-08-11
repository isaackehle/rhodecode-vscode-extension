// Integration tests for configuration functions — runs inside the live extension host.
import * as assert from 'assert';
import * as vscode from 'vscode';
import { normalizeServerUrl, isApiKeyFromEnvEnabled, getApiKeyRaw } from '../../configuration';

suite('Configuration – normalizeServerUrl', () => {
    const cases: Array<{ name: string; input: string; wantUrl?: string; wantError?: string | true }> = [
        { name: 'bare hostname', input: 'rhodecode.example.com', wantUrl: 'https://rhodecode.example.com' },
        { name: 'https already', input: 'https://rhodecode.example.com', wantUrl: 'https://rhodecode.example.com' },
        { name: 'http allowed', input: 'http://rhodecode.example.com', wantUrl: 'http://rhodecode.example.com' },
        {
            name: 'trailing slash strip',
            input: 'https://rhodecode.example.com///',
            wantUrl: 'https://rhodecode.example.com',
        },
        { name: 'host:port', input: 'rhodecode.example.com:8000', wantUrl: 'https://rhodecode.example.com:8000' },
        { name: 'IPv4', input: '192.168.1.10', wantUrl: 'https://192.168.1.10' },
        { name: 'empty string', input: '', wantError: 'Server address is empty.' },
        { name: 'whitespace only', input: '   ', wantError: 'Server address is empty.' },
        { name: 'spaces in host', input: 'https://rhode code.example.com', wantError: true },
    ];

    for (const c of cases) {
        test(c.name, () => {
            const result = normalizeServerUrl(c.input);
            if (c.wantUrl !== undefined) {
                assert.ok('url' in result, `Expected url, got ${JSON.stringify(result)}`);
                assert.strictEqual((result as { url: string }).url, c.wantUrl);
            } else {
                assert.ok('error' in result, `Expected error, got ${JSON.stringify(result)}`);
                if (typeof c.wantError === 'string') {
                    assert.strictEqual((result as { error: string }).error, c.wantError);
                }
            }
        });
    }
});

suite('Configuration – apikeyFromEnv setting', () => {
    let savedValue: boolean;

    suiteSetup(async () => {
        savedValue = isApiKeyFromEnvEnabled();
    });

    suiteTeardown(async () => {
        await vscode.workspace
            .getConfiguration('rhodecode')
            .update('apikeyFromEnv', savedValue, vscode.ConfigurationTarget.Global);
    });

    test('defaults to false', () => {
        // On a fresh workspace the setting should not be explicitly set.
        const val = vscode.workspace.getConfiguration('rhodecode').get<boolean>('apikeyFromEnv');
        assert.strictEqual(val, false);
    });

    test('isApiKeyFromEnvEnabled reflects setting', async () => {
        await vscode.workspace
            .getConfiguration('rhodecode')
            .update('apikeyFromEnv', true, vscode.ConfigurationTarget.Global);
        assert.strictEqual(isApiKeyFromEnvEnabled(), true);

        await vscode.workspace
            .getConfiguration('rhodecode')
            .update('apikeyFromEnv', false, vscode.ConfigurationTarget.Global);
        assert.strictEqual(isApiKeyFromEnvEnabled(), false);
    });

    test('getApiKeyRaw respects apikeyFromEnv=false (returns setting value)', async () => {
        await vscode.workspace
            .getConfiguration('rhodecode')
            .update('apikeyFromEnv', false, vscode.ConfigurationTarget.Global);
        await vscode.workspace
            .getConfiguration('rhodecode')
            .update('apikey', 'test-api-key', vscode.ConfigurationTarget.Global);

        assert.strictEqual(getApiKeyRaw(), 'test-api-key');

        await vscode.workspace.getConfiguration('rhodecode').update('apikey', '', vscode.ConfigurationTarget.Global);
    });

    test('getApiKeyRaw returns undefined when apikeyFromEnv=true and no .env file present', async () => {
        await vscode.workspace
            .getConfiguration('rhodecode')
            .update('apikeyFromEnv', true, vscode.ConfigurationTarget.Global);
        // No RHODECODE_API_KEY in env and no .env files in test workspace.
        const key = getApiKeyRaw();
        assert.strictEqual(key, undefined);
    });
});
