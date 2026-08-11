// Generic test runner: discovers and runs all test files in scripts/
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const scriptsDir = __dirname;
const testFiles = fs.readdirSync(scriptsDir)
    .filter(f => f.startsWith('test-') && (f.endsWith('.cjs') || f.endsWith('.ts')))
    .sort();

if (testFiles.length === 0) {
    console.log('No test files found in scripts/');
    process.exit(0);
}

console.log(`Running ${testFiles.length} test file(s):\n`);

let failures = 0;

for (const file of testFiles) {
    const filePath = path.join(scriptsDir, file);
    const isTs = file.endsWith('.ts');
    
    console.log(`>>> ${file}`);
    try {
        if (isTs) {
            execSync(`bun run ${filePath}`, { stdio: 'inherit' });
        } else {
            execSync(`node ${filePath}`, { stdio: 'inherit' });
        }
        console.log(`✓ ${file} passed\n`);
    } catch (err) {
        console.error(`✗ ${file} failed\n`);
        failures++;
    }
}

console.log('='.repeat(50));
if (failures === 0) {
    console.log(`All ${testFiles.length} test file(s) passed`);
    process.exit(0);
} else {
    console.log(`${failures} test file(s) FAILED`);
    process.exit(1);
}
