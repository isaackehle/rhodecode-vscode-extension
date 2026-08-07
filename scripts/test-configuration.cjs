// Unit tests for configuration.ts pure logic (normalizeServerUrl, getApiKeyRaw, isApiKeyFromEnvEnabled)
// using the same vscode stub as test-extension-load.cjs so no live VS Code host is needed.

const Module = require('module');
const os = require('os');
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

// ---- normalizeServerUrl --------------------------------------------------

const { normalizeServerUrl } = require(path.resolve(__dirname, '..', 'out', 'configuration.js'));

const urlCases = [
    { name: 'bare hostname',        input: 'rhodecode.example.com',             want: { url: 'https://rhodecode.example.com' } },
    { name: 'https already',        input: 'https://rhodecode.example.com',     want: { url: 'https://rhodecode.example.com' } },
    { name: 'http allowed',         input: 'http://rhodecode.example.com',      want: { url: 'http://rhodecode.example.com' } },
    { name: 'trailing slash strip', input: 'https://rhodecode.example.com///',  want: { url: 'https://rhodecode.example.com' } },
    { name: 'host with port',       input: 'rhodecode.example.com:8000',        want: { url: 'https://rhodecode.example.com:8000' } },
    { name: 'empty string',         input: '',                                   want: { error: 'Server address is empty.' } },
    { name: 'whitespace only',      input: '   ',                               want: { error: 'Server address is empty.' } },
    { name: 'spaces in host',       input: 'https://rhode code.example.com',    want: 'error' },
    { name: 'IPv4',                 input: '192.168.1.10',                      want: { url: 'https://192.168.1.10' } },
    { name: 'IPv4 with port',       input: 'https://192.168.1.10:8080',         want: { url: 'https://192.168.1.10:8080' } },
];

for (const c of urlCases) {
    const got = normalizeServerUrl(c.input);
    if (c.want === 'error') {
        check(c.name, 'error' in got, `want error, got ${JSON.stringify(got)}`);
    } else if ('url' in c.want) {
        check(c.name, got.url === c.want.url, `want ${JSON.stringify(c.want)} got ${JSON.stringify(got)}`);
    } else {
        check(c.name, 'error' in got && got.error === c.want.error,
            `want ${JSON.stringify(c.want)} got ${JSON.stringify(got)}`);
    }
}

// ---- isApiKeyFromEnvEnabled / getApiKeyRaw -- stub-driven ----------------
// We re-stub the vscode workspace.getConfiguration to return controlled values.

const vscodeStub = require(vscodeStubPath);

function withConfig(settings, fn) {
    const orig = vscodeStub.workspace.getConfiguration;
    vscodeStub.workspace.getConfiguration = () => ({
        get: (key, defaultVal) => (key in settings ? settings[key] : defaultVal),
        update: () => Promise.resolve(),
    });
    try {
        return fn();
    } finally {
        vscodeStub.workspace.getConfiguration = orig;
    }
}

// getApiKeyRaw() falls through to the real filesystem (os.homedir() + '/.env') when
// apikeyFromEnv is on, so it must run against a directory guaranteed to have no .env —
// otherwise the test silently depends on the machine it runs on (e.g. it fails on a
// dev box that has a real ~/.env set up for the apikeyFromEnv feature).
function withNoHomeEnvFile(fn) {
    const orig = os.homedir;
    os.homedir = () => path.join(os.tmpdir(), 'rhodecode-test-empty-home');
    try {
        return fn();
    } finally {
        os.homedir = orig;
    }
}

// Reload configuration to pick up the stubbed vscode (already loaded via Module hook above)
const { isApiKeyFromEnvEnabled, getApiKeyRaw } = require(path.resolve(__dirname, '..', 'out', 'configuration.js'));

check(
    'isApiKeyFromEnvEnabled false by default',
    withConfig({}, () => isApiKeyFromEnvEnabled()) === false,
);

check(
    'isApiKeyFromEnvEnabled true when set',
    withConfig({ apikeyFromEnv: true }, () => isApiKeyFromEnvEnabled()) === true,
);

check(
    'getApiKeyRaw returns setting when apikeyFromEnv off',
    withConfig({ apikey: 'my-key', apikeyFromEnv: false }, () => getApiKeyRaw()) === 'my-key',
);

check(
    'getApiKeyRaw returns undefined (no env file) when apikeyFromEnv on',
    withNoHomeEnvFile(() => withConfig({ apikeyFromEnv: true }, () => getApiKeyRaw())) === undefined,
);

// ---- summary -------------------------------------------------------------

console.log(
    failures === 0
        ? `\nAll ${urlCases.length + 4} configuration tests passed`
        : `\n${failures} test(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
