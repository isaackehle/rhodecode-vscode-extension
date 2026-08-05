// Quick sanity test for parseDotEnv (issue #2)
import { parseDotEnv } from '../src/dotenvParser.ts';

const cases: Array<{ name: string; input: string; want: Record<string, string> }> = [
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

let failures = 0;
for (const c of cases) {
    const got = parseDotEnv(c.input);
    const gotJson = JSON.stringify(got);
    const wantJson = JSON.stringify(c.want);
    const ok = gotJson === wantJson;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}`);
    if (!ok) {
        failures++;
        console.log(`  want ${wantJson}\n  got  ${gotJson}`);
    }
}
console.log(failures === 0 ? `\nAll ${cases.length} tests passed` : `\n${failures} test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
