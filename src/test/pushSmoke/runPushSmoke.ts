// One-off smoke test: sets up a throwaway git repo (bare "origin" + a working
// clone), boots a real VS Code extension host with that repo open and the
// built-in git extension enabled, then runs src/test/pushSmoke/index.ts inside
// it to prove watchForPushes() reacts to an actual `git push`.
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
    await execFileAsync('git', args, { cwd });
}

async function setupRepo(): Promise<{ root: string; work: string }> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rhodecode-push-smoke-'));
    const origin = path.join(root, 'origin.git');
    const work = path.join(root, 'work');

    await execFileAsync('git', ['init', '--bare', origin]);

    fs.mkdirSync(work);
    await git(work, ['init', '-b', 'main']);
    await git(work, ['config', 'user.email', 'smoke-test@example.com']);
    await git(work, ['config', 'user.name', 'Smoke Test']);
    await git(work, ['config', 'commit.gpgsign', 'false']);
    await git(work, ['remote', 'add', 'origin', origin]);

    fs.writeFileSync(path.join(work, 'README.md'), 'push-smoke test fixture\n');
    await git(work, ['add', 'README.md']);
    await git(work, ['commit', '-m', 'initial commit']);
    await git(work, ['push', '-u', 'origin', 'main']);

    return { root, work };
}

async function main() {
    const { root, work } = await setupRepo();
    console.log(`[push-smoke] fixture repo: ${work}`);

    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
        const extensionTestsPath = path.resolve(__dirname, './index');

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            // Open the fixture repo; deliberately do NOT pass --disable-extensions
            // so the built-in git extension (which watchForPushes depends on) loads.
            launchArgs: [work],
        });
        console.log('[push-smoke] SUCCESS');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main().catch((err) => {
    console.error('[push-smoke] FAILED:', err);
    process.exit(1);
});
