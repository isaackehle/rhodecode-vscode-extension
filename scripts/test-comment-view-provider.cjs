// Regression tests for commentViewProvider.handleMessage() error handling.
//
// Bug: none of the reply/resolveTask/addTask/toggleHandled branches were
// wrapped in try/catch, unlike every other client call in the codebase
// (which reports failures via reportError()). A rejected API call (network
// error, server rejection) was silently swallowed — no user feedback, no
// console signal. Fixed by wrapping the switch in try/catch and calling
// reportError(message.type, err).

const Module = require('module');
const path = require('path');

const vscodeStubPath = path.resolve(__dirname, 'vscode-stub.cjs');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    if (request === 'vscode') return vscodeStubPath;
    return origResolve.call(this, request, ...args);
};

const vscodeStub = require(vscodeStubPath);

let failures = 0;

function check(name, ok, extra) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    if (!ok) {
        failures++;
        if (extra) console.log(`  ${extra}`);
    }
}

const { CommentViewProvider } = require(path.resolve(__dirname, '..', 'out', 'commentViewProvider.js'));

const FAKE_PR = { pull_request_id: 42, title: 'Test PR' };

function makeTree() {
    const handled = new Set();
    return {
        invalidateComments: async () => {},
        store: {
            isHandled: (_repoId, _prId, commentId) => handled.has(commentId),
            setHandled: (_repoId, _prId, commentId, value) => {
                if (value) handled.add(commentId);
                else handled.delete(commentId);
            },
        },
    };
}

/** Build a provider with `this.pr` set and `this.panel` left undefined so render() no-ops. */
function makeProvider(client, tree) {
    const provider = new CommentViewProvider(() => client, tree);
    provider.pr = FAKE_PR;
    return provider;
}

/** Capture showErrorMessage calls made during `fn`, restoring the stub afterwards. */
async function captureErrorMessages(fn) {
    const orig = vscodeStub.window.showErrorMessage;
    const calls = [];
    vscodeStub.window.showErrorMessage = (...args) => {
        calls.push(args);
        return undefined;
    };
    try {
        await fn();
    } finally {
        vscodeStub.window.showErrorMessage = orig;
    }
    return calls;
}

async function main() {
    // reply: client call rejects -> caught, reported, does not throw out of handleMessage.
    {
        const client = {
            commentOnPullRequest: async () => {
                throw new Error('network down');
            },
        };
        const provider = makeProvider(client, makeTree());
        let threw = false;
        const calls = await captureErrorMessages(async () => {
            try {
                await provider.handleMessage({ type: 'reply', commentId: '1', text: 'hi' });
            } catch {
                threw = true;
            }
        });
        check('reply: rejected client call does not escape handleMessage', !threw);
        check(
            'reply: rejected client call reports an error to the user',
            calls.length === 1 && String(calls[0][0]).includes('network down'),
            `calls=${JSON.stringify(calls)}`,
        );
    }

    // resolveTask: same contract.
    {
        const client = {
            resolveTodoComment: async () => {
                throw new Error('server rejected resolve');
            },
        };
        const provider = makeProvider(client, makeTree());
        let threw = false;
        const calls = await captureErrorMessages(async () => {
            try {
                await provider.handleMessage({ type: 'resolveTask', commentId: '2', text: 'done' });
            } catch {
                threw = true;
            }
        });
        check('resolveTask: rejected client call does not escape handleMessage', !threw);
        check(
            'resolveTask: rejected client call reports an error to the user',
            calls.length === 1 && String(calls[0][0]).includes('server rejected resolve'),
            `calls=${JSON.stringify(calls)}`,
        );
    }

    // addTask: same contract.
    {
        const client = {
            addTodoComment: async () => {
                throw new Error('addTodoComment failed');
            },
        };
        const provider = makeProvider(client, makeTree());
        let threw = false;
        const calls = await captureErrorMessages(async () => {
            try {
                await provider.handleMessage({ type: 'addTask', text: 'new task' });
            } catch {
                threw = true;
            }
        });
        check('addTask: rejected client call does not escape handleMessage', !threw);
        check(
            'addTask: rejected client call reports an error to the user',
            calls.length === 1 && String(calls[0][0]).includes('addTodoComment failed'),
            `calls=${JSON.stringify(calls)}`,
        );
    }

    // toggleHandled: only calls the client when markHandledPostsComment is on;
    // here it isn't configured, so no client call is made and nothing throws.
    {
        const client = {
            commentOnPullRequest: async () => {
                throw new Error('should not be called');
            },
        };
        const provider = makeProvider(client, makeTree());
        let threw = false;
        const calls = await captureErrorMessages(async () => {
            try {
                await provider.handleMessage({ type: 'toggleHandled', commentId: '3' });
            } catch {
                threw = true;
            }
        });
        check('toggleHandled: does not throw when markHandledPostsComment is off', !threw);
        check('toggleHandled: does not call the client when markHandledPostsComment is off', calls.length === 0);
    }

    // Happy path sanity check: a successful reply calls through and reports nothing.
    {
        const calledWith = [];
        const client = {
            commentOnPullRequest: async (prId, text) => {
                calledWith.push([prId, text]);
            },
        };
        const provider = makeProvider(client, makeTree());
        const calls = await captureErrorMessages(async () => {
            await provider.handleMessage({ type: 'reply', commentId: '1', text: 'looks good' });
        });
        check(
            'reply: successful client call is invoked with pr id + text',
            calledWith.length === 1 && calledWith[0][0] === FAKE_PR.pull_request_id && calledWith[0][1] === 'looks good',
            `calledWith=${JSON.stringify(calledWith)}`,
        );
        check('reply: successful client call reports no error', calls.length === 0);
    }

    console.log(failures === 0 ? '\nAll commentViewProvider tests passed' : `\n${failures} test(s) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main();
