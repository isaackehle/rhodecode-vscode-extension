// Unit tests for pushDetection.ts (isPushTransition)

import { BranchAheadState, isPushTransition } from '../src/pushDetection';

let failures = 0;

function check(name: string, ok: boolean, extra?: string): void {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    if (!ok) {
        failures++;
        if (extra) console.log(`  ${extra}`);
    }
}

function state(partial: Partial<BranchAheadState>): BranchAheadState {
    return { branch: 'feature/x', ahead: undefined, hasUpstream: true, ...partial };
}

const cases: { name: string; previous: BranchAheadState | undefined; current: BranchAheadState; want: boolean }[] = [
    {
        name: 'ahead drops from 1 to 0 on the same branch (push)',
        previous: state({ ahead: 1 }),
        current: state({ ahead: 0 }),
        want: true,
    },
    {
        name: 'ahead drops from 5 to 0 on the same branch (push)',
        previous: state({ ahead: 5 }),
        current: state({ ahead: 0 }),
        want: true,
    },
    {
        name: 'first push of a brand-new branch (no upstream -> upstream, ahead 0)',
        previous: state({ ahead: undefined, hasUpstream: false }),
        current: state({ ahead: 0, hasUpstream: true }),
        want: true,
    },
    {
        name: 'new branch created but not yet pushed (still no upstream)',
        previous: state({ ahead: undefined, hasUpstream: false }),
        current: state({ ahead: undefined, hasUpstream: false }),
        want: false,
    },
    {
        name: 'ahead stays 0 (no local commits)',
        previous: state({ ahead: 0 }),
        current: state({ ahead: 0 }),
        want: false,
    },
    {
        name: 'ahead rises 0 to 1 (new commit)',
        previous: state({ ahead: 0 }),
        current: state({ ahead: 1 }),
        want: false,
    },
    {
        name: 'ahead stays >0 (still unpushed)',
        previous: state({ ahead: 2 }),
        current: state({ ahead: 2 }),
        want: false,
    },
    {
        name: 'no previous observation (first event ever)',
        previous: undefined,
        current: state({ ahead: 0 }),
        want: false,
    },
    {
        name: 'branch switch, not a push (different branch, unrelated ahead counts)',
        previous: state({ branch: 'feature/other', ahead: 2 }),
        current: state({ branch: 'feature/x', ahead: 0 }),
        want: false,
    },
    {
        name: 'current branch undefined (detached HEAD)',
        previous: state({ ahead: 1 }),
        current: state({ branch: undefined, ahead: 0 }),
        want: false,
    },
];

for (const c of cases) {
    const got = isPushTransition(c.previous, c.current);
    check(c.name, got === c.want, `want ${c.want}, got ${got}`);
}

console.log(failures === 0 ? `\nAll ${cases.length} pushDetection tests passed` : `\n${failures} test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
