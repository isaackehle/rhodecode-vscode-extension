// Quick sanity test for dotenv parser + git remote normalization
import { parseDotEnv } from '../src/dotenvParser.ts';
import { normalizeRepoPath, cloneUrisMatch } from '../src/gitRemote.ts';

const envCases: Array<{ name: string; input: string; want: Record<string, string> }> = [
    {
        name: 'simple',
        input: 'RHODECODE_API_KEY=abc123\nFOO=bar\n',
        want: { RHODECODE_API_KEY: 'abc123', FOO: 'bar' },
    },
    {
        name: 'quotes and comments',
        input: '# comment\nRHODECODE_API_KEY="quoted key"\nFOO=\'single\'\nEMPTY=\n',
        want: { RHODECODE_API_KEY: 'quoted key', FOO: 'single', EMPTY: '' },
    },
    {
        name: 'spaces around equals',
        input: 'RHODECODE_API_KEY = spaced-key \n',
        want: { RHODECODE_API_KEY: 'spaced-key' },
    },
    {
        name: 'blank and garbage lines',
        input: '\n\nNOEQUALS\nRHODECODE_API_KEY=ok\n',
        want: { RHODECODE_API_KEY: 'ok' },
    },
];

const pathCases: Array<{ name: string; input: string; want: string | undefined }> = [
    { name: 'https', input: 'https://github.com/isaackehle/rhodecode-vscode-extension.git', want: 'isaackehle/rhodecode-vscode-extension' },
    { name: 'http', input: 'http://git.example.com/team/services/api.git', want: 'team/services/api' },
    { name: 'ssh', input: 'ssh://git@github.com/isaackehle/repo.git', want: 'isaackehle/repo' },
    { name: 'scp-like', input: 'git@github.com:isaackehle/repo.git', want: 'isaackehle/repo' },
    { name: 'no-suffix', input: 'https://github.com/isaackehle/repo', want: 'isaackehle/repo' },
    { name: 'trailing-slash', input: 'https://github.com/isaackehle/repo/', want: 'isaackehle/repo' },
    { name: 'empty', input: '  ', want: undefined },
];

const matchCases: Array<{ name: string; a: string | null; b: string; want: boolean }> = [
    { name: 'same https', a: 'https://github.com/isaackehle/repo.git', b: 'https://github.com/isaackehle/repo.git', want: true },
    { name: 'scp vs https', a: 'git@github.com:isaackehle/repo.git', b: 'https://github.com/isaackehle/repo.git', want: true },
    { name: 'different repo', a: 'https://github.com/isaackehle/other.git', b: 'https://github.com/isaackehle/repo.git', want: false },
    { name: 'null clone_uri', a: null, b: 'https://github.com/isaackehle/repo.git', want: false },
];

let failures = 0;
function check(name: string, ok: boolean, extra?: string): void {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    if (!ok) {
        failures++;
        if (extra) {
            console.log(`  ${extra}`);
        }
    }
}

for (const c of envCases) {
    const got = JSON.stringify(parseDotEnv(c.input));
    check(c.name, got === JSON.stringify(c.want), `want ${JSON.stringify(c.want)} got ${got}`);
}
for (const c of pathCases) {
    const got = normalizeRepoPath(c.input);
    check(c.name, got === c.want, `want ${c.want} got ${got}`);
}
for (const c of matchCases) {
    check(c.name, cloneUrisMatch(c.a, c.b) === c.want, `want ${c.want} got ${cloneUrisMatch(c.a, c.b)}`);
}

console.log(failures === 0 ? `\nAll ${envCases.length + pathCases.length + matchCases.length} tests passed` : `\n${failures} test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
