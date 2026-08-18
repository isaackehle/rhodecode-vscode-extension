// Runs inside a live VS Code extension host with the real built-in `vscode.git`
// extension enabled (unlike src/test/suite, which runs with --disable-extensions).
// Verifies watchForPushes() fires when a real `git push` happens on disk.
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { Repository } from '../../git_extension_api';
// Compiled JS at runtime lives at out/test/pushSmoke/index.js, so this reaches out/pushWatcher.js.
import { watchForPushes } from '../../push_watcher';

const execFileAsync = promisify(execFile);

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for `branch` to show up in `pushed`, nudging the git extension with
 * repeated `status()` calls along the way. A real user gets a free refresh
 * when they tab back into VS Code after pushing from an external terminal
 * (the git extension refreshes on window focus); this headless host never
 * regains focus, so the nudge substitutes for that instead of relying on
 * the extension's own auto-refresh timer, which would make the test flaky.
 */
async function waitForDetection(repo: Repository, pushed: string[], branch: string): Promise<boolean> {
    for (let i = 0; i < 25; i++) {
        if (pushed.includes(branch)) {
            return true;
        }
        await repo.status?.();
        await sleep(400);
    }
    return pushed.includes(branch);
}

export async function run(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        throw new Error('No workspace folder open (expected the smoke-test repo to be passed as launchArgs)');
    }
    const repoPath = folder.uri.fsPath;

    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt) {
        throw new Error('vscode.git extension is not installed in this test host');
    }
    await gitExt.activate();
    const gitApi = gitExt.exports.getAPI(1);
    for (let i = 0; i < 50 && gitApi.repositories.length === 0; i++) {
        await sleep(200);
    }
    if (gitApi.repositories.length === 0) {
        throw new Error('git extension never discovered the smoke-test repository');
    }
    const repo = gitApi.repositories[0];

    const pushed: string[] = [];
    const disposable = watchForPushes((branch) => pushed.push(branch));

    try {
        const branch = 'feature/push-smoke-test';
        await execFileAsync('git', ['checkout', '-b', branch], { cwd: repoPath });
        await execFileAsync('git', ['commit', '--allow-empty', '-m', 'smoke test commit'], { cwd: repoPath });
        await sleep(1000); // let the extension observe the pre-push (no-upstream) state first

        await execFileAsync('git', ['push', '-u', 'origin', branch], { cwd: repoPath });
        if (!(await waitForDetection(repo, pushed, branch))) {
            throw new Error(`watchForPushes did not fire for "${branch}" after its first publish`);
        }
        console.log(`[push-smoke] PASS: first publish of "${branch}" detected`);

        // Second scenario: the branch already has an upstream; push a
        // follow-up commit and confirm the ahead>0 -> 0 transition fires too.
        pushed.length = 0;
        await execFileAsync('git', ['commit', '--allow-empty', '-m', 'follow-up commit'], { cwd: repoPath });
        await sleep(1000);
        await execFileAsync('git', ['push', 'origin', branch], { cwd: repoPath });
        if (!(await waitForDetection(repo, pushed, branch))) {
            throw new Error(`watchForPushes did not fire for the follow-up push to "${branch}"`);
        }
        console.log(`[push-smoke] PASS: follow-up push to "${branch}" detected`);
    } finally {
        disposable.dispose();
    }
}
