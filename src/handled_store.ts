import { Memento } from 'vscode';

/**
 * Local tracking of which comments have been "handled".
 *
 * RhodeCode has no server-side "resolve comment" API, so handled state is
 * stored per-workspace in VS Code's Memento storage (keyed by repo + PR).
 * Optionally, a reply comment can also be posted to the PR thread
 * (see rhodecode.markHandledPostsComment).
 */
export class HandledStore {
    private static readonly KEY_PREFIX = 'rhodecode.handled.v1.';

    private readonly memento: Memento;

    constructor(memento: Memento) {
        this.memento = memento;
    }

    private key(repoId: string, pullRequestId: string | number): string {
        return `${HandledStore.KEY_PREFIX}${repoId}#${pullRequestId}`;
    }

    getHandled(repoId: string, pullRequestId: string | number): Set<string> {
        const value = this.memento.get<string[]>(this.key(repoId, pullRequestId), []);
        return new Set(value);
    }

    isHandled(repoId: string, pullRequestId: string | number, commentId: string): boolean {
        return this.getHandled(repoId, pullRequestId).has(String(commentId));
    }

    setHandled(repoId: string, pullRequestId: string | number, commentId: string, handled: boolean): void {
        const current = this.getHandled(repoId, pullRequestId);
        const id = String(commentId);
        if (handled) {
            current.add(id);
        } else {
            current.delete(id);
        }
        void this.memento.update(this.key(repoId, pullRequestId), [...current]);
    }

    clear(repoId: string, pullRequestId: string | number): void {
        void this.memento.update(this.key(repoId, pullRequestId), []);
    }
}
