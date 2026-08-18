// Regression test for rhodecode.selectRepository (commands.ts).
//
// Bug: when no client existed, the command delegated to rhodecode.connect
// and then unconditionally returned — even when connect succeeded and called
// setClient(). The user had to invoke "Select Repository" a second time to
// actually browse repos. Fixed by re-checking getClient() after the
// delegated connect and continuing into repo browsing when it now exists.

const Module = require('module');
const path = require('path');

const vscodeStubPath = path.resolve(__dirname, 'vscode-stub.cjs');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'vscode') return vscodeStubPath;
    return origResolve.call(this, request, ...args);
};

const vscodeStub = require(vscodeStubPath);

let failures = 0;

function check(name, ok, extra) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    if (!ok) {
        failures++;
        if (extra) console.log(`  ${extra}`);
    }
}

// Load serverSetup first so we hold the exact module object commands.js will
// require (Node's require cache is keyed by resolved path) — then stub
// browseRepositories on it. commands.js reads the property at call time via
// `(0, serverSetup_1.browseRepositories)`, so overriding it here takes effect.
const serverSetupPath = path.resolve(__dirname, '..', 'out', 'server_setup.js');
const serverSetup = require(serverSetupPath);

const { registerCommands } = require(path.resolve(__dirname, '..', 'out', 'commands.js'));

function makeHarness() {
    const registered = new Map();
    const origRegisterCommand = vscodeStub.commands.registerCommand;
    const origExecuteCommand = vscodeStub.commands.executeCommand;

    vscodeStub.commands.registerCommand = (name, handler) => {
        registered.set(name, handler);
        return { dispose: () => {} };
    };
    vscodeStub.commands.executeCommand = async (name, ...args) => {
        const handler = registered.get(name);
        if (!handler) {
            throw new Error(`No command registered: ${name}`);
        }
        return handler(...args);
    };

    const restore = () => {
        vscodeStub.commands.registerCommand = origRegisterCommand;
        vscodeStub.commands.executeCommand = origExecuteCommand;
    };

    return { registered, restore };
}

function fakeClient(overrides = {}) {
    return {
        getServerUrl: () => 'https://rhodecode.example.com',
        getApiKey: () => 'key',
        ...overrides,
    };
}

function fakeContext() {
    return { subscriptions: { push: () => {} } };
}

function fakeTree() {
    return { load: async () => {}, invalidateComments: async () => {} };
}

function fakeCommentView() {
    return { show: async () => {} };
}

async function main() {
    // Scenario 1: connect succeeds (sets a client) -> selectRepository should
    // flow straight into repo browsing instead of returning early.
    {
        const { registered, restore } = makeHarness();
        try {
            const connectedClient = fakeClient();
            const pickedRepo = { repo_id: 1, repo_name: 'team/repo', repo_type: 'git', clone_uri: null };

            let currentClient; // undefined until "connect" runs
            const setClient = (c) => {
                currentClient = c;
            };
            const getClient = () => currentClient;
            const refreshAllCalls = [];
            const refreshAll = async () => {
                refreshAllCalls.push(true);
            };

            // Stand in for rhodecode.connect: on invocation, it sets the client
            // (mirroring what the real handler does on a successful wizard run).
            // Must be set AFTER registerCommands, which registers its own real
            // 'rhodecode.connect' handler into the same map.
            let browseRepositoriesCalledWith;
            serverSetup.browseRepositories = async (client) => {
                browseRepositoriesCalledWith = client;
                return pickedRepo;
            };

            registerCommands(fakeContext(), getClient, fakeTree(), fakeCommentView(), setClient, refreshAll);

            registered.set('rhodecode.connect', async () => {
                setClient(connectedClient);
            });

            await vscodeStub.commands.executeCommand('rhodecode.selectRepository');

            check(
                'selectRepository browses repos after a successful delegated connect',
                browseRepositoriesCalledWith === connectedClient,
            );
            check('selectRepository rebuilds the client with the picked repo', currentClient !== connectedClient);
            check('selectRepository calls refreshAll after picking a repo', refreshAllCalls.length === 1);
        } finally {
            restore();
        }
    }

    // Scenario 2: connect is cancelled (no client set) -> selectRepository
    // must return early without calling browseRepositories.
    {
        const { registered, restore } = makeHarness();
        try {
            let currentClient;
            const setClient = (c) => {
                currentClient = c;
            };
            const getClient = () => currentClient;
            const refreshAllCalls = [];
            const refreshAll = async () => {
                refreshAllCalls.push(true);
            };

            let browseRepositoriesCalled = false;
            serverSetup.browseRepositories = async () => {
                browseRepositoriesCalled = true;
                return undefined;
            };

            registerCommands(fakeContext(), getClient, fakeTree(), fakeCommentView(), setClient, refreshAll);

            registered.set('rhodecode.connect', async () => {
                // user cancelled the wizard — no setClient() call
            });

            await vscodeStub.commands.executeCommand('rhodecode.selectRepository');

            check('selectRepository does not browse repos when connect is cancelled', !browseRepositoriesCalled);
            check('selectRepository does not call refreshAll when connect is cancelled', refreshAllCalls.length === 0);
        } finally {
            restore();
        }
    }

    // Scenario 3: a client already exists -> connect is never invoked.
    {
        const { registered, restore } = makeHarness();
        try {
            const existingClient = fakeClient();
            const getClient = () => existingClient;
            const setClient = () => {};
            const refreshAll = async () => {};

            let connectCalled = false;
            registered.set('rhodecode.connect', async () => {
                connectCalled = true;
            });

            let browseRepositoriesCalledWith;
            serverSetup.browseRepositories = async (client) => {
                browseRepositoriesCalledWith = client;
                return undefined;
            };

            registerCommands(fakeContext(), getClient, fakeTree(), fakeCommentView(), setClient, refreshAll);

            await vscodeStub.commands.executeCommand('rhodecode.selectRepository');

            check('selectRepository does not delegate to connect when a client already exists', !connectCalled);
            check(
                'selectRepository browses repos with the existing client',
                browseRepositoriesCalledWith === existingClient,
            );
        } finally {
            restore();
        }
    }

    console.log(failures === 0 ? '\nAll selectRepository tests passed' : `\n${failures} test(s) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main();
