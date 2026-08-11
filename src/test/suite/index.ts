// Entry point loaded inside the VS Code extension host.
// Discovers and runs all *.test.js files in this directory.
import * as path from 'path';
import Mocha from 'mocha';
import { globSync } from 'glob';

export function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 20000 });
    const testsRoot = __dirname;

    const files = globSync('**/*.test.js', { cwd: testsRoot });
    for (const f of files) {
        mocha.addFile(path.join(testsRoot, f));
    }

    return new Promise((resolve, reject) => {
        mocha.run((failures) => {
            if (failures > 0) {
                reject(new Error(`${failures} test(s) failed`));
            } else {
                resolve();
            }
        });
    });
}
