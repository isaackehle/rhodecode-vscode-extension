// Unit tests for RepoBrowserPanel (repoBrowserPanel.ts)
//
// Tests cover:
// - Panel creation and showing
// - Message handling (connect, selectRepo, refresh)
// - Repository selection updates workspace state
// - HTML content generation with proper escaping

const Module = require('module');
const path = require('path');

const vscodeStubPath = path.resolve(__dirname, 'vscode-stub.cjs');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'vscode') return vscodeStubPath;
    return origResolve.call(this, request, ...args);
};

let failures = 0;

function check(name, ok, extra) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    if (!ok) {
        failures++;
        if (extra) console.log(`  ${extra}`);
    }
}

// Extend vscode stub to support webview panel tracking
const vscodeStub = require(vscodeStubPath);

let createdPanels = [];
let lastPanel = null;

vscodeStub.window.createWebviewPanel = function (viewType, title, ...args) {
    const panel = {
        viewType,
        title,
        webview: {
            html: '',
            onDidReceiveMessage: (callback) => {
                panel.messageCallback = callback;
                return { dispose: () => {} };
            },
            onDidChangeState: () => ({ dispose: () => {} }),
            asWebviewUri: (uri) => ({ toString: () => uri.toString() }),
        },
        onDidDispose: (callback) => {
            panel.disposeCallback = callback;
            return { dispose: () => {} };
        },
        reveal: (column) => {
            panel.revealedColumn = column;
        },
        dispose: () => {
            if (panel.disposeCallback) panel.disposeCallback();
        },
    };
    createdPanels.push(panel);
    lastPanel = panel;
    return panel;
};

vscodeStub.window.activeTextEditor = null;
vscodeStub.ViewColumn = { One: 1, Two: 2 };

// Track setStoredRepo calls
let storedRepos = [];
const originalRepoStatePath = path.resolve(__dirname, '..', 'out', 'repoState.js');
delete require.cache[originalRepoStatePath];

const repoStateModule = require(originalRepoStatePath);
const originalSetStoredRepo = repoStateModule.setStoredRepo;
repoStateModule.setStoredRepo = async (repo) => {
    storedRepos.push(repo);
    return originalSetStoredRepo ? originalSetStoredRepo(repo) : Promise.resolve();
};

const originalGetRepoIdRaw = repoStateModule.getRepoIdRaw;
repoStateModule.getRepoIdRaw = () => originalGetRepoIdRaw ? originalGetRepoIdRaw() : undefined;


// Mock RhodeCodeClient
const originalRequestPath = path.resolve(__dirname, '..', 'out', 'rhodecoderequest.js');
delete require.cache[originalRequestPath];

const rhodeCodeModule = require(originalRequestPath);
let mockClient = null;

rhodeCodeModule.RhodeCodeClient = class MockRhodeCodeClient {
    constructor(serverUrl, apiKey, repoName) {
        this._serverUrl = serverUrl;
        this._apiKey = apiKey;
        this._repoName = repoName;
    }
    
    static async createForDetection() {
        return mockClient;
    }
    
    async getRepoGroups() {
        return mockClient.groups || [];
    }
    
    async getRepos(root, traverse) {
        return mockClient.repos || [];
    }
    
    getServerUrl() { return this._serverUrl; }
    getApiKey() { return this._apiKey; }
};

// Mock configuration
const originalConfigPath = path.resolve(__dirname, '..', 'out', 'configuration.js');
delete require.cache[originalConfigPath];

const configModule = require(originalConfigPath);
configModule.getServerUrlRaw = () => mockClient._serverUrl;
configModule.getApiKeyRaw = () => mockClient._apiKey;

// Now load the module under test
const originalPanelPath = path.resolve(__dirname, '..', 'out', 'repoBrowserPanel.js');
delete require.cache[originalPanelPath];

const { RepoBrowserPanel } = require(originalPanelPath);

function resetState() {
    createdPanels = [];
    lastPanel = null;
    storedRepos = [];
    mockClient = null;
    RepoBrowserPanel.current = undefined;
}


// ---- Tests ----

async function testPanelCreation() {
    resetState();
    
    mockClient = new rhodeCodeModule.RhodeCodeClient('https://rc.example.com', 'test-key', 'team/repo');
    mockClient.groups = [{ group_id: 1, group_name: 'team', group_description: 'Test team' }];
    mockClient.repos = [
        { repo_id: 1, repo_name: 'team/repo1', repo_type: 'git', clone_uri: 'https://rc.example.com/rhodecode/team/repo1' },
        { repo_id: 2, repo_name: 'team/repo2', repo_type: 'git', clone_uri: 'https://rc.example.com/rhodecode/team/repo2' },
    ];
    
    const context = { subscriptions: { push: (item) => {} } };
    RepoBrowserPanel.createOrShow(context);
    
    check('Panel is created', createdPanels.length === 1);
    check('Panel has correct viewType', createdPanels[0].viewType === 'rhodecodeRepoBrowser');
    check('Panel has correct title', createdPanels[0].title === 'RhodeCode Repositories');
    check('Panel HTML is set', lastPanel.webview.html.length > 0);
    check('RepoBrowserPanel.current is set', RepoBrowserPanel.current !== undefined);
}

async function testPanelRevealOnSecondCall() {
    resetState();
    
    mockClient = new rhodeCodeModule.RhodeCodeClient('https://rc.example.com', 'test-key', 'team/repo');
    mockClient.groups = [];
    mockClient.repos = [];
    
    const context = { subscriptions: { push: (item) => {} } };
    RepoBrowserPanel.createOrShow(context);
    const firstPanel = lastPanel;
    
    RepoBrowserPanel.createOrShow(context);
    
    check('Second call reveals existing panel', createdPanels.length === 1);
    check('Panel is revealed', firstPanel.revealedColumn !== undefined);
}

async function testConnectMessage() {
    resetState();
    
    mockClient = new rhodeCodeModule.RhodeCodeClient('https://rc.example.com', 'test-key', 'team/repo');
    mockClient.groups = [];
    mockClient.repos = [];
    
    let connectCommandCalled = false;
    vscodeStub.commands.executeCommand = async (cmd, ...args) => {
        if (cmd === 'rhodecode.connect') {
            connectCommandCalled = true;
        }
    };
    
    const context = { subscriptions: { push: (item) => {} } };
    RepoBrowserPanel.createOrShow(context);
    
    // Simulate connect button click
    if (lastPanel.webview.messageCallback) {
        await lastPanel.webview.messageCallback({ type: 'connect' });
    }
    
    check('Connect message triggers rhodecode.connect command', connectCommandCalled);
}

async function testSelectRepoMessage() {
    resetState();
    
    mockClient = new rhodeCodeModule.RhodeCodeClient('https://rc.example.com', 'test-key', 'team/repo');
    mockClient.groups = [];
    mockClient.repos = [
        { repo_id: 1, repo_name: 'team/repo1', repo_type: 'git', clone_uri: null },
    ];
    
    const context = { subscriptions: { push: (item) => {} } };
    RepoBrowserPanel.createOrShow(context);
    
    // Simulate repo selection
    if (lastPanel.webview.messageCallback) {
        await lastPanel.webview.messageCallback({ type: 'selectRepo', repoName: 'team/repo1' });
    }
    
    check('Select repo message stores the repo', storedRepos.length === 1);
    check('Stored repo has correct name', storedRepos[0]?.repo_name === 'team/repo1');
}

async function testRefreshMessage() {
    resetState();
    
    mockClient = new rhodeCodeModule.RhodeCodeClient('https://rc.example.com', 'test-key', 'team/repo');
    mockClient.groups = [{ group_id: 1, group_name: 'team', group_description: 'Test team' }];
    mockClient.repos = [{ repo_id: 1, repo_name: 'team/repo1', repo_type: 'git', clone_uri: null }];
    
    const context = { subscriptions: { push: (item) => {} } };
    RepoBrowserPanel.createOrShow(context);
    
    const htmlBefore = lastPanel.webview.html;
    
    // Change mock data
    mockClient.groups = [{ group_id: 2, group_name: 'other-team', group_description: 'Other team' }];
    mockClient.repos = [{ repo_id: 2, repo_name: 'other/repo1', repo_type: 'git', clone_uri: null }];
    
    // Simulate refresh
    if (lastPanel.webview.messageCallback) {
        await lastPanel.webview.messageCallback({ type: 'refresh' });
    }
    
    check('Refresh updates panel HTML', lastPanel.webview.html !== htmlBefore);
    check('Refresh shows new group', lastPanel.webview.html.includes('other-team'));
    check('Refresh shows new repo', lastPanel.webview.html.includes('other/repo1'));
}

async function testHtmlContainsServerUrl() {
    resetState();
    
    mockClient = new rhodeCodeModule.RhodeCodeClient('https://rc.example.com:8080', 'test-key', 'team/repo');
    mockClient.groups = [];
    mockClient.repos = [];
    
    const context = { subscriptions: { push: (item) => {} } };
    RepoBrowserPanel.createOrShow(context);
    
    check('HTML contains server URL', lastPanel.webview.html.includes('rc.example.com'));
    check('HTML contains port', lastPanel.webview.html.includes('8080'));
}

async function testHtmlContainsCurrentRepo() {
    resetState();
    
    mockClient = new rhodeCodeModule.RhodeCodeClient('https://rc.example.com', 'test-key', 'team/current-repo');

async function testHtmlEscaping() {
    resetState();
    
    mockClient = new rhodeCodeModule.RhodeCodeClient('https://rc.example.com', 'test-key', 'team/repo');
    mockClient.groups = [{ group_id: 1, group_name: '<script>alert(1)</script>', group_description: 'Test' }];
    mockClient.repos = [{ repo_id: 1, repo_name: 'team/<evil>', repo_type: 'git', clone_uri: null }];
    
    const context = { subscriptions: { push: (item) => {} } };
    RepoBrowserPanel.createOrShow(context);
    
    check('Script tags are escaped in group name', lastPanel.webview.html.includes('&lt;script&gt;'));
    check('Script tags are escaped in repo name', lastPanel.webview.html.includes('&lt;evil&gt;'));
    check('Raw script tags not present', !lastPanel.webview.html.includes('<script>alert'));
}

async function testUnconnectedState() {
    resetState();
    
    // No mock client = unconnected
    configModule.getServerUrlRaw = () => undefined;
    
    const context = { subscriptions: { push: (item) => {} } };
    RepoBrowserPanel.createOrShow(context);
    
    check('HTML shows not connected', lastPanel.webview.html.includes('(not connected)'));
    check('HTML shows connect button', lastPanel.webview.html.includes('Connect to RhodeCode'));
}

async function testEmptyGroupsAndRepos() {
    resetState();
    
    mockClient = new rhodeCodeModule.RhodeCodeClient('https://rc.example.com', 'test-key', 'team/repo');
    mockClient.groups = [];
    mockClient.repos = [];
    
    const context = { subscriptions: { push: (item) => {} } };
    RepoBrowserPanel.createOrShow(context);
    
    check('HTML renders without errors', lastPanel.webview.html.length > 0);
    check('HTML contains valid HTML structure', lastPanel.webview.html.includes('<html'));
}

async function testRefreshWhenUnconnected() {
    resetState();
    
    configModule.getServerUrlRaw = () => undefined;

// ---- Run all tests ----

async function runAllTests() {
    console.log('Running RepoBrowserPanel tests...\n');
    
    await testPanelCreation();
    await testPanelRevealOnSecondCall();
    await testConnectMessage();
    await testSelectRepoMessage();
    await testRefreshMessage();
    await testHtmlContainsServerUrl();
    await testHtmlContainsCurrentRepo();
    await testHtmlEscaping();
    await testUnconnectedState();
    await testEmptyGroupsAndRepos();
    await testRefreshWhenUnconnected();
    
    console.log('='.repeat(50));
    if (failures === 0) {
        console.log('All RepoBrowserPanel tests passed');
        process.exit(0);
    } else {
        console.log(`${failures} test(s) FAILED`);
        process.exit(1);
    }
}

runAllTests();

    
    const context = { subscriptions: { push: (item) => {} } };
    RepoBrowserPanel.createOrShow(context);
    
    // Refresh when unconnected should not throw
    try {
        if (lastPanel.webview.messageCallback) {
            await lastPanel.webview.messageCallback({ type: 'refresh' });
        }
        check('Refresh when unconnected does not throw', true);
    } catch (err) {
        check('Refresh when unconnected does not throw', false, err.message);
    }
}

    mockClient.groups = [];
    mockClient.repos = [];
    
    const context = { subscriptions: { push: (item) => {} } };
    RepoBrowserPanel.createOrShow(context);
    
    check('HTML contains current repo name', lastPanel.webview.html.includes('team/current-repo'));
}

