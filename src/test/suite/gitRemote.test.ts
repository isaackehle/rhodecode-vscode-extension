import * as assert from 'assert';
import { isRhodeCodeRemote, extractServerHost } from '../../git_remote';

suite('gitRemote Auto-Detection', () => {
    suite('isRhodeCodeRemote', () => {
        test('detects https URLs with /rhodecode/', () => {
            assert.strictEqual(isRhodeCodeRemote('https://example.com/rhodecode/myrepo'), true);
            assert.strictEqual(isRhodeCodeRemote('https://example.com/team/rhodecode/myrepo'), true);
        });

        test('detects ssh URLs with :rhodecode/', () => {
            assert.strictEqual(isRhodeCodeRemote('git@example.com:rhodecode/myrepo'), true);
            assert.strictEqual(isRhodeCodeRemote('git@example.com:team/rhodecode/myrepo'), true);
            assert.strictEqual(isRhodeCodeRemote('git@example.com:rhodecode/myrepo.git'), true);
        });

        test('rejects non-RhodeCode URLs', () => {
            assert.strictEqual(isRhodeCodeRemote('https://github.com/user/repo'), false);
            assert.strictEqual(isRhodeCodeRemote('https://github.com/rhodecode-user/repo'), false);
            assert.strictEqual(isRhodeCodeRemote('https://gitlab.com/group/project'), false);
            assert.strictEqual(isRhodeCodeRemote('https://rhodecode-user.github.io/repo'), false);
        });

        test('is case-insensitive', () => {
            assert.strictEqual(isRhodeCodeRemote('https://example.com/RhodeCode/myrepo'), true);
        });
    });

    suite('extractServerHost', () => {
        test('extracts host from https URLs', () => {
            assert.strictEqual(extractServerHost('https://example.com/rhodecode/myrepo'), 'example.com');
            assert.strictEqual(extractServerHost('https://example.com:8443/rhodecode/myrepo'), 'example.com:8443');
        });

        test('extracts host from ssh URLs', () => {
            assert.strictEqual(extractServerHost('git@example.com:rhodecode/myrepo'), 'example.com');
            assert.strictEqual(extractServerHost('user@example.com:rhodecode/myrepo'), 'example.com');
            assert.strictEqual(extractServerHost('ssh://git@example.com/rhodecode/myrepo'), 'example.com');
        });

        test('handles .git suffix', () => {
            assert.strictEqual(extractServerHost('git@example.com:rhodecode/myrepo.git'), 'example.com');
        });
    });
});
