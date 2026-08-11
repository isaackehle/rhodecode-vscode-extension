// Unit tests for gitRemote.ts pure functions (isRhodeCodeRemote, extractServerHost)

import { isRhodeCodeRemote, extractServerHost, normalizeRepoPath, cloneUrisMatch } from '../src/gitRemote';

let failures = 0;

function check(name: string, ok: boolean, extra?: string): void {
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

// ---- summary -------------------------------------------------------------

console.log(
    failures === 0
        ? `\nAll ${rhodeCodeCases.length + hostCases.length + pathCases.length + matchCases.length} gitRemote tests passed`
        : `\n${failures} test(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
