import * as vscode from 'vscode';
import { GitAPI, GitExtension, Repository } from './git_extension_api';
import { BranchAheadState, isPushTransition } from './push_detection';

/**
 * Watch all open git repositories for pushed branches (issue #6) and invoke
 * `onPush` with the branch name whenever one is detected.
 */
export function watchForPushes(onPush: (branch: string) => void): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];
    const lastState = new Map<string, BranchAheadState>();

    function attach(repo: Repository): void {
        const key = repo.rootUri.toString();
        disposables.push(
            repo.state.onDidChange(() => {
                const head = repo.state.HEAD;
                const current: BranchAheadState = {
                    branch: head?.name,
                    ahead: head?.ahead,
                    hasUpstream: head?.upstream !== undefined,
                };
                const previous = lastState.get(key);
                lastState.set(key, current);
                if (current.branch && isPushTransition(previous, current)) {
                    onPush(current.branch);
                }
            }),
        );
    }

    void (async () => {
        const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!ext) {
            return;
        }
        const gitExtension = ext.isActive ? ext.exports : await ext.activate();
        const api: GitAPI = gitExtension.getAPI(1);
        for (const repo of api.repositories) {
            attach(repo);
        }
        disposables.push(api.onDidOpenRepository((repo) => attach(repo)));
    })();

    return new vscode.Disposable(() => {
        for (const d of disposables) {
            d.dispose();
        }
    });
}
