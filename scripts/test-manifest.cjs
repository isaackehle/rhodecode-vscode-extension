// Validates package.json manifest consistency to catch the class of bug where a
// command is added but not wired into activationEvents (or vice versa), which
// causes "command not found" on fresh installs.

const path = require('path');
const pkg = require(path.resolve(__dirname, '..', 'package.json'));

let failures = 0;

function check(name, ok, extra) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    if (!ok) {
        failures++;
        if (extra) console.log(`  ${extra}`);
    }
}

// ---- build sets -----------------------------------------------------------

const contributed = new Set(pkg.contributes.commands.map(c => c.command));

const activationCommands = new Set(
    pkg.activationEvents
        .filter(e => e.startsWith('onCommand:'))
        .map(e => e.replace('onCommand:', '')),
);

// ---- every contributed command must have an activationEvent ---------------

for (const cmd of [...contributed].sort()) {
    check(
        `activationEvents includes ${cmd}`,
        activationCommands.has(cmd),
        `Add "onCommand:${cmd}" to activationEvents in package.json`,
    );
}

// ---- every onCommand activationEvent must map to a real command -----------

for (const cmd of [...activationCommands].sort()) {
    check(
        `contributes.commands includes ${cmd}`,
        contributed.has(cmd),
        `"onCommand:${cmd}" in activationEvents has no matching entry in contributes.commands`,
    );
}

// ---- every command registered in commands.ts must be contributed ----------
// We parse the source file for registerCommand calls rather than requiring it,
// so this stays a plain Node script with no vscode import needed.

const fs = require('fs');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'commands.ts'), 'utf8');
const registered = new Set([...src.matchAll(/registerCommand\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]));

for (const cmd of [...registered].sort()) {
    check(
        `contributed command ${cmd} is registered in commands.ts`,
        contributed.has(cmd),
        `"${cmd}" is registered in commands.ts but missing from contributes.commands in package.json`,
    );
}

for (const cmd of [...contributed].sort()) {
    // connect and selectRepository are registered inline in commands.ts under different names — skip false positives
    const ignore = new Set(['rhodecode.openChangeset']); // registered in pullRequestTreeProvider
    if (ignore.has(cmd)) continue;
    check(
        `${cmd} is registered in commands.ts`,
        registered.has(cmd),
        `"${cmd}" is in contributes.commands but not registered via registerCommand in commands.ts`,
    );
}

// ---- summary --------------------------------------------------------------

const total = contributed.size * 2 + registered.size + (contributed.size - 1 /* ignore set */);
console.log(
    failures === 0
        ? `\nAll manifest consistency checks passed`
        : `\n${failures} manifest check(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
