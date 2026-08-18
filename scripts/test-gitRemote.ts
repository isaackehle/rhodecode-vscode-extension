// Unit tests for gitRemote.ts functions
// Tests: isRhodeCodeRemote, extractServerHost, normalizeRepoPath, cloneUrisMatch, getGitRemoteUrl, getCurrentBranch

import {
    isRhodeCodeRemote,
    extractServerHost,
    normalizeRepoPath,
    cloneUrisMatch,
    getGitRemoteUrl,
    getCurrentBranch,
} from '../src/git_remote';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

let failures = 0;
let testCount = 0;

function check(name: string, ok: boolean, extra?: string): void {
    testCount++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    if (!ok) {
        failures++;
        if (extra) console.log(`  ${extra}`);
    }
}

// ---- isRhodeCodeRemote --------------------------------------------------

const rhodeCodeCases = [
    { name: 'https with /rhodecode/', url: 'https://example.com/rhodecode/myrepo', want: true },
    { name: 'https with /rhodecode/ in path', url: 'https://example.com/team/rhodecode/myrepo', want: true },
    { name: 'ssh with :rhodecode/', url: 'git@example.com:rhodecode/myrepo', want: true },
    { name: 'ssh with :rhodecode/ in path', url: 'git@example.com:team/rhodecode/myrepo', want: true },
    { name: 'ssh with .git suffix', url: 'git@example.com:rhodecode/myrepo.git', want: true },
    { name: 'github not rhodecode', url: 'https://github.com/user/repo', want: false },
    { name: 'github with rhodecode user', url: 'https://github.com/rhodecode-user/repo', want: false },
    { name: 'gitlab not rhodecode', url: 'https://gitlab.com/group/project', want: false },
    { name: 'host contains rhodecode but path does not', url: 'https://rhodecode-user.github.io/repo', want: false },
    { name: 'case insensitive', url: 'https://example.com/RhodeCode/myrepo', want: true },
];

for (const c of rhodeCodeCases) {
    const got = isRhodeCodeRemote(c.url);
    check(c.name, got === c.want, `want ${c.want}, got ${got}`);
}

// ---- extractServerHost --------------------------------------------------

const hostCases = [
    { name: 'https URL', url: 'https://example.com/rhodecode/myrepo', want: 'example.com' },
    { name: 'https with port', url: 'https://example.com:8443/rhodecode/myrepo', want: 'example.com:8443' },
    { name: 'ssh scp-like', url: 'git@example.com:rhodecode/myrepo', want: 'example.com' },
    { name: 'ssh with user prefix', url: 'user@example.com:rhodecode/myrepo', want: 'example.com' },
    { name: 'ssh with .git suffix', url: 'git@example.com:rhodecode/myrepo.git', want: 'example.com' },
    { name: 'ssh:// explicit', url: 'ssh://git@example.com/rhodecode/myrepo', want: 'example.com' },
    { name: 'github (not rhodecode)', url: 'https://github.com/user/repo', want: 'github.com' },
];

for (const c of hostCases) {
    const got = extractServerHost(c.url);
    check(c.name, got === c.want, `want ${c.want}, got ${got}`);
}

// ---- normalizeRepoPath (existing function, verify it still works) -------

const pathCases = [
    { name: 'https URL', url: 'https://example.com/rhodecode/myrepo', want: 'rhodecode/myrepo' },
    { name: 'https with .git', url: 'https://example.com/rhodecode/myrepo.git', want: 'rhodecode/myrepo' },
    { name: 'ssh scp-like', url: 'git@example.com:rhodecode/myrepo', want: 'rhodecode/myrepo' },
    { name: 'ssh with .git', url: 'git@example.com:rhodecode/myrepo.git', want: 'rhodecode/myrepo' },
    { name: 'trailing slash', url: 'https://example.com/rhodecode/myrepo/', want: 'rhodecode/myrepo' },
];

for (const c of pathCases) {
    const got = normalizeRepoPath(c.url);
    check(c.name, got === c.want, `want ${c.want}, got ${got}`);
}

// ---- cloneUrisMatch (existing function, verify it still works) ----------

const matchCases = [
    { name: 'exact match', uri: 'rhodecode/myrepo', remote: 'https://example.com/rhodecode/myrepo', want: true },
    { name: 'case insensitive', uri: 'RhodeCode/MyRepo', remote: 'https://example.com/rhodecode/myrepo', want: true },
    { name: 'no match', uri: 'other/repo', remote: 'https://example.com/rhodecode/myrepo', want: false },
    { name: 'null uri', uri: null, remote: 'https://example.com/rhodecode/myrepo', want: false },
];

for (const c of matchCases) {
    const got = cloneUrisMatch(c.uri, c.remote);
    check(c.name, got === c.want, `want ${c.want}, got ${got}`);
}

// ---- getGitRemoteUrl and getCurrentBranch (integration tests) ------------

async function runGitTests(): Promise<void> {
    const tmpDir = join('/tmp', `git-test-${Date.now()}`);

    try {
        // Create a temporary directory and initialize a git repo
        await mkdir(tmpDir, { recursive: true });
        await writeFile(join(tmpDir, 'README.md'), 'test');

        // Initialize git repo
        await execFileAsync('git', ['init'], { cwd: tmpDir });
        await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
        await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
        await execFileAsync('git', ['add', 'README.md'], { cwd: tmpDir });
        await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpDir });

        // Test 1: getGitRemoteUrl with https remote
        await execFileAsync('git', ['remote', 'add', 'origin', 'https://example.com/rhodecode/test-repo'], {
            cwd: tmpDir,
        });
        let result = await getGitRemoteUrl(tmpDir);
        check(
            'getGitRemoteUrl with https remote',
            result !== undefined &&
                result.url === 'https://example.com/rhodecode/test-repo' &&
                result.path === 'rhodecode/test-repo' &&
                (result.branch === 'master' || result.branch === 'main'), // Git 2.x+ uses 'main' by default
            `got: ${JSON.stringify(result)}`,
        );

        // Test 2: getGitRemoteUrl with ssh remote
        await execFileAsync('git', ['remote', 'set-url', 'origin', 'git@example.com:rhodecode/test-repo.git'], {
            cwd: tmpDir,
        });
        result = await getGitRemoteUrl(tmpDir);
        check(
            'getGitRemoteUrl with ssh remote',
            result !== undefined &&
                result.url === 'git@example.com:rhodecode/test-repo.git' &&
                result.path === 'rhodecode/test-repo',
            `got: ${JSON.stringify(result)}`,
        );

        // Test 3: getCurrentBranch on feature branch
        await execFileAsync('git', ['checkout', '-b', 'feature-branch'], { cwd: tmpDir });
        const branch = await getCurrentBranch(tmpDir);
        check('getCurrentBranch on feature branch', branch === 'feature-branch', `got: ${branch}`);

        // Test 4: getGitRemoteUrl returns undefined for non-git directory
        const nonGitDir = join('/tmp', `non-git-test-${Date.now()}`);
        await mkdir(nonGitDir);
        const notGitResult = await getGitRemoteUrl(nonGitDir);
        check(
            'getGitRemoteUrl returns undefined for non-git directory',
            notGitResult === undefined,
            `got: ${JSON.stringify(notGitResult)}`,
        );
        await rm(nonGitDir, { recursive: true, force: true });

        // Test 5: getGitRemoteUrl returns undefined when no remote
        const noRemoteDir = join(tmpDir, 'no-remote');
        await mkdir(noRemoteDir);
        await execFileAsync('git', ['init'], { cwd: noRemoteDir });
        await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: noRemoteDir });
        await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: noRemoteDir });
        const noRemoteResult = await getGitRemoteUrl(noRemoteDir);
        check(
            'getGitRemoteUrl returns undefined when no remote',
            noRemoteResult === undefined,
            `got: ${JSON.stringify(noRemoteResult)}`,
        );

        // Test 6: getGitRemoteUrl with nested repo path
        await execFileAsync('git', ['remote', 'set-url', 'origin', 'https://example.com/team/subteam/my-repo.git'], {
            cwd: tmpDir,
        });
        result = await getGitRemoteUrl(tmpDir);
        check(
            'getGitRemoteUrl with nested repo path',
            result !== undefined && result.path === 'team/subteam/my-repo',
            `got: ${JSON.stringify(result)}`,
        );
    } catch (err) {
        console.error('Error running git tests:', err);
        failures++;
    } finally {
        // Cleanup
        await rm(tmpDir, { recursive: true, force: true });
    }
}

// Run async tests
await runGitTests();

// ---- summary -------------------------------------------------------------

const pureFunctionTests = rhodeCodeCases.length + hostCases.length + pathCases.length + matchCases.length;
const integrationTests = 6; // Number of git integration tests

console.log(
    failures === 0
        ? `\nAll ${pureFunctionTests + integrationTests} gitRemote tests passed (${pureFunctionTests} pure function + ${integrationTests} integration)`
        : `\n${failures} test(s) FAILED out of ${testCount}`,
);
process.exit(failures === 0 ? 0 : 1);
