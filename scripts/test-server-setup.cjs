// Regression tests for serverSetup.promptApiKey / showTokenHelp.
//
// Bug: when the user typed an empty key, showTokenHelp() re-prompted on
// "Retry" and returned the new key, but promptApiKey() discarded that
// return value and always resolved to undefined — so a successful retry
// still cancelled the whole connect wizard. Fixed by threading the
// showTokenHelp() return value back through promptApiKey().

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

const { promptApiKey } = require(path.resolve(__dirname, '..', 'out', 'server_setup.js'));

/**
 * Runs `fn` with workspace.getConfiguration, window.showInputBox, and
 * window.showErrorMessage stubbed to the given scenario, then restores the
 * originals no matter how `fn` resolves.
 */
async function withScenario({ config, inputBoxReplies, errorMessageReplies }, fn) {
    const origGetConfiguration = vscodeStub.workspace.getConfiguration;
    const origShowInputBox = vscodeStub.window.showInputBox;
    const origShowErrorMessage = vscodeStub.window.showErrorMessage;

    const inputQueue = [...inputBoxReplies];
    const errorQueue = [...errorMessageReplies];

    vscodeStub.workspace.getConfiguration = () => ({
        get: (key, defaultVal) => (key in config ? config[key] : defaultVal),
        update: () => Promise.resolve(),
    });
    vscodeStub.window.showInputBox = () => Promise.resolve(inputQueue.shift());
    vscodeStub.window.showErrorMessage = () => Promise.resolve(errorQueue.shift());

    try {
        return await fn();
    } finally {
        vscodeStub.workspace.getConfiguration = origGetConfiguration;
        vscodeStub.window.showInputBox = origShowInputBox;
        vscodeStub.window.showErrorMessage = origShowErrorMessage;
    }
}

async function main() {
    // Regression: empty input -> showTokenHelp -> user picks "Retry" -> types
    // a valid key the second time. Must return that key, not undefined.
    await withScenario(
        {
            config: { apikeyFromEnv: false, apikey: '' },
            inputBoxReplies: ['   ', 'a-valid-key-from-retry'],
            errorMessageReplies: ['Retry'],
        },
        async () => {
            const key = await promptApiKey();
            check(
                'promptApiKey returns the retried key instead of discarding it',
                key === 'a-valid-key-from-retry',
                `got ${JSON.stringify(key)}`,
            );
        },
    );

    // User dismisses the "must not be empty" modal without retrying.
    await withScenario(
        {
            config: { apikeyFromEnv: false, apikey: '' },
            inputBoxReplies: [''],
            errorMessageReplies: [undefined],
        },
        async () => {
            const key = await promptApiKey();
            check(
                'promptApiKey returns undefined when the user does not retry',
                key === undefined,
                `got ${JSON.stringify(key)}`,
            );
        },
    );

    // Baseline: a key typed on the first try is returned directly, no help dialog.
    await withScenario(
        {
            config: { apikeyFromEnv: false, apikey: '' },
            inputBoxReplies: ['first-try-key'],
            errorMessageReplies: [],
        },
        async () => {
            const key = await promptApiKey();
            check(
                'promptApiKey returns a key typed on the first try',
                key === 'first-try-key',
                `got ${JSON.stringify(key)}`,
            );
        },
    );

    // Cancelling the input box (undefined, distinct from an empty string)
    // short-circuits before ever reaching showTokenHelp.
    await withScenario(
        {
            config: { apikeyFromEnv: false, apikey: '' },
            inputBoxReplies: [undefined],
            errorMessageReplies: [],
        },
        async () => {
            const key = await promptApiKey();
            check(
                'promptApiKey returns undefined when the input box is cancelled',
                key === undefined,
                `got ${JSON.stringify(key)}`,
            );
        },
    );

    console.log(failures === 0 ? '\nAll serverSetup tests passed' : `\n${failures} test(s) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main();
