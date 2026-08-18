import { Event, Uri } from 'vscode';

/**
 * Minimal slice of the built-in `vscode.git` extension API (types are not
 * published as a package, so only the fields this extension reads are
 * declared here). See microsoft/vscode's `extensions/git/src/api/git.d.ts`
 * for the full surface.
 */
export interface Branch {
    readonly name?: string;
    readonly ahead?: number;
    readonly behind?: number;
    readonly upstream?: { readonly remote: string; readonly name: string };
}

export interface RepositoryState {
    readonly HEAD: Branch | undefined;
    readonly onDidChange: Event<void>;
}

export interface Repository {
    readonly rootUri: Uri;
    readonly state: RepositoryState;
    /** Force a status recompute. Exposed by the real API; not used in production, only test diagnostics. */
    status?(): Promise<void>;
}

export interface GitAPI {
    readonly repositories: Repository[];
    readonly onDidOpenRepository: Event<Repository>;
}

export interface GitExtension {
    getAPI(version: 1): GitAPI;
}
