// Integration test runner: downloads VS Code, boots the extension host,
// then runs every *.test.js file in out/test/suite/.
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../..');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            // Open an empty temp workspace so there is no accidental project-level config.
            launchArgs: ['--disable-extensions'],
        });
    } catch (err) {
        console.error('Integration test run failed:', err);
        process.exit(1);
    }
}

main();
