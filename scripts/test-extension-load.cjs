// Smoke test: load the compiled extension module graph exactly like the VS Code
// extension host does at activation, with a real 'vscode' stub module.
// Regression test for #5: "commands not found" caused by require("axios") at
// runtime while the .vsix ships no node_modules. Runs under node (the compiled
// out/ is plain CJS; bun's runtime does not honor Module._resolveFilename hooks).
const Module = require('module');
const path = require('path');

const vscodeStubPath = path.resolve(__dirname, 'vscode-stub.cjs');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'vscode') return vscodeStubPath;
    return origResolve.call(this, request, ...args);
};

const outDir = path.resolve(__dirname, '..', 'out');
const modules = ['extension', 'rhodecode_request', 'configuration', 'envfile', 'dotenv_parser', 'git_remote', 'repo_state', 'handled_store', 'server_setup', 'commands', 'comment_view_provider', 'comment_parser', 'pull_request_tree_provider', 'pr_status_bar', 'push_detection', 'push_watcher', 'git_extension_api', 'repo_browser_panel'];

let failures = 0;
for (const m of modules) {
    try {
        require(path.join(outDir, m + '.js'));
        console.log(`PASS  ${m}.js loaded (no missing modules)`);
    } catch (e) {
        failures++;
        console.log(`FAIL  ${m}.js -> ${e.message}`);
    }
}
console.log(failures === 0 ? `\nSMOKE TEST OK: ${modules.length}/${modules.length} modules load` : `\nSMOKE TEST FAILED: ${failures} module(s) failed`);
process.exit(failures === 0 ? 0 : 1);
