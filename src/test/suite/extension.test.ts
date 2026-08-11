// Integration tests: run inside a live VS Code extension host.
import * as assert from 'assert';
import * as vscode from 'vscode';

const EXT_ID = 'isaackehle.rhodecode-vscode-extension';

suite('Extension – activation', () => {
    test('extension is registered', () => {
        const ext = vscode.extensions.getExtension(EXT_ID);
        assert.ok(ext, `Extension "${EXT_ID}" not found`);
    });

    test('extension activates without error', async () => {
        const ext = vscode.extensions.getExtension(EXT_ID);
        if (!ext) throw new Error(`Extension "${EXT_ID}" not found`);
        await ext.activate();
        assert.ok(ext.isActive, 'Extension is not active after activate()');
    });
});

suite('Extension – command registration', () => {
    const expectedCommands = [
        'rhodecode.connect',
        'rhodecode.selectRepository',
        'rhodecode.refresh',
        'rhodecode.showPullRequests',
        'rhodecode.showComments',
        'rhodecode.replyComment',
        'rhodecode.markHandled',
        'rhodecode.markUnhandled',
        'rhodecode.openPullRequest',
        'rhodecode.approveAndMerge',
        'rhodecode.createPullRequest',
        'rhodecode.openChangeset',
    ];

    test('all commands are registered', async () => {
        const ext = vscode.extensions.getExtension(EXT_ID);
        await ext?.activate();
        const all = await vscode.commands.getCommands(true);
        for (const cmd of expectedCommands) {
            assert.ok(all.includes(cmd), `Command "${cmd}" was not registered`);
        }
    });
});

suite('Extension – configuration schema', () => {
    const expectedSettings: Record<string, unknown> = {
        'rhodecode.serverurl': '',
        'rhodecode.apikey': '',
        'rhodecode.apikeyFromEnv': false,
        'rhodecode.markHandledPostsComment': false,
    };

    for (const [key, defaultVal] of Object.entries(expectedSettings)) {
        test(`${key} has correct default`, () => {
            const [section, prop] = key.split('.') as [string, string];
            const cfg = vscode.workspace.getConfiguration(section);
            const actual = cfg.get(prop);
            assert.strictEqual(actual, defaultVal, `Default for ${key} should be ${JSON.stringify(defaultVal)}`);
        });
    }
});

suite('Extension – viewsWelcome shown when unconfigured', () => {
    test('serverurl is empty on a fresh workspace', () => {
        const url = vscode.workspace.getConfiguration('rhodecode').get<string>('serverurl');
        // On CI (no pre-configured workspace) this should be empty.
        assert.strictEqual(url, '', 'serverurl should default to empty string');
    });
});
