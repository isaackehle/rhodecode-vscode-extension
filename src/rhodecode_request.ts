import { window } from 'vscode';
import * as config from './configuration';
import { getStoredRepo } from './repo_state';
import { logDebug } from './extension';
import {
    CommentResult,
    PullRequestCommentData,
    RepoGroup,
    RepoInfo,
    RepoRefs,
    RhodeCodePullRequest,
    RhodeCodeResponse,
} from './model/rhodecode';

/**
 * Minimal JSON-RPC client for the RhodeCode API.
 * Endpoint: POST {serverUrl}/_admin/api with { id, api_key, method, args }.
 */
export class RhodeCodeClient {
    private serverUrl: string;
    private apiKey: string;
    private repoId: number; // Integer ID for API calls
    private repoName: string; // Path for URLs

    constructor(serverUrl: string, apiKey: string, repoId: number | string, repoName?: string) {
        this.serverUrl = serverUrl;
        this.apiKey = apiKey;
        // Accept either integer ID or string path; convert if needed
        if (typeof repoId === 'string') {
            // If it's a string path (e.g., 'ES-CCMCS/SDR'), store it for URLs
            this.repoName = repoId;
            this.repoId = 0; // Placeholder; will be updated when repo_id is known
        } else {
            this.repoId = repoId;
            this.repoName = repoName || String(repoId);
        }
    }

    static async create(): Promise<RhodeCodeClient | undefined> {
        const serverUrl = await config.getApiUrl();
        const apiKey = await config.getApiKey();
        const storedRepo = getStoredRepo();
        if (!serverUrl || !apiKey || !storedRepo) {
            return undefined;
        }
        // Use the integer repo_id from stored repo
        return new RhodeCodeClient(serverUrl, apiKey, storedRepo.repo_id, storedRepo.repo_name);
    }

    /**
     * Client for calls that don't need a repo id (e.g. get_repos during
     * git-remote auto-detection). Returns undefined if server/key are missing.
     * Does NOT prompt the user - uses raw config values only.
     */
    static async createForDetection(): Promise<RhodeCodeClient | undefined> {
        const serverUrl = config.getServerUrlRaw();
        const apiKey = config.getApiKeyRaw();
        if (!serverUrl || !apiKey) {
            return undefined;
        }
        return new RhodeCodeClient(serverUrl, apiKey, '');
    }

    private async post<T>(method: string, args: Record<string, unknown>): Promise<RhodeCodeResponse<T>> {
        logDebug(`API CALL: ${method} with args: ${JSON.stringify(args)}`);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        let response: Response;
        try {
            response = await fetch(`${this.serverUrl}/_admin/api`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: '1',
                    api_key: this.apiKey,
                    method,
                    args,
                }),
                signal: controller.signal,
            });
        } catch (err) {
            logDebug(`API ERROR (${method}): ${err instanceof Error ? err.message : String(err)}`);
            throw new Error(`RhodeCode API request failed: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            clearTimeout(timer);
        }

        if (response.status !== 200) {
            const error = `RhodeCode API returned HTTP ${response.status}`;
            logDebug(`API ERROR (${method}): ${error}`);
            throw new Error(error);
        }

        const result = (await response.json()) as RhodeCodeResponse<T>;
        if (result.error) {
            logDebug(`API ERROR (${method}): ${JSON.stringify(result.error)}`);
        } else {
            logDebug(`API RESPONSE (${method}): success, result type: ${typeof result.result}`);
        }
        return result;
    }

    async getPullRequests(status: 'new' | 'open' | 'closed' = 'new'): Promise<RhodeCodePullRequest[]> {
        const data = await this.post<RhodeCodePullRequest[]>('get_pull_requests', {
            repoid: this.repoId,
            status,
        });
        this.throwIfError(data);
        return data.result ?? [];
    }

    /** Set the repo ID after it's been resolved from the path. */
    setRepoId(repoId: number, repoName: string): void {
        this.repoId = repoId;
        this.repoName = repoName;
    }

    /**
     * Create an inline comment on a specific line in a file (RhodeCode API comment_commit).
     * This creates a proper inline comment that can be linked to in the PR view.
     */
    async commentOnCommit(
        commitId: string,
        message: string,
        filepath: string,
        lineno: number,
        commentType: 'note' | 'todo' = 'note',
    ): Promise<CommentResult> {
        const args: Record<string, unknown> = {
            repoid: this.repoId,
            commit_id: commitId,
            message,
            filepath,
            lineno: String(lineno),
            comment_type: commentType,
        };
        const data = await this.post<CommentResult>('comment_commit', args);
        this.throwIfError(data);
        return data.result!;
    }

    async commentOnPullRequest(
        pullRequestId: string | number,
        message: string,
        status?: 'approved' | 'rejected' | 'under_review' | 'not_reviewed',
    ): Promise<CommentResult> {
        const args: Record<string, unknown> = {
            repoid: this.repoId,
            pullrequestid: pullRequestId,
            message,
        };
        if (status) {
            args.status = status;
        }
        const data = await this.post<CommentResult>('comment_pull_request', args);
        this.throwIfError(data);
        return data.result!;
    }

    /**
     * List all comments on a pull request (modern API, RhodeCode 4.6+).
     * Throws when the server does not support the method (fall back to
     * HTML parsing in that case).
     */
    async getPullRequestComments(pullRequestId: string | number): Promise<PullRequestCommentData[]> {
        const data = await this.post<PullRequestCommentData[]>('get_pull_request_comments', {
            pullrequestid: pullRequestId,
            repoid: this.repoId,
        });
        this.throwIfError(data);
        return data.result ?? [];
    }

    /**
     * Close a task (TODO comment) on a pull request. Creates a resolving
     * comment; the server rejects the call if the comment is not a todo.
     */
    async resolveTodoComment(
        pullRequestId: string | number,
        commentId: string | number,
        message: string,
    ): Promise<CommentResult> {
        const data = await this.post<CommentResult>('comment_pull_request', {
            repoid: this.repoId,
            pullrequestid: pullRequestId,
            message,
            resolves_comment_id: commentId,
        });
        this.throwIfError(data);
        return data.result!;
    }

    /** Create a new task (TODO comment) on a pull request. */
    async addTodoComment(pullRequestId: string | number, message: string): Promise<CommentResult> {
        const data = await this.post<CommentResult>('comment_pull_request', {
            repoid: this.repoId,
            pullrequestid: pullRequestId,
            message,
            comment_type: 'todo',
        });
        this.throwIfError(data);
        return data.result!;
    }

    async approvePullRequest(pullRequestId: string | number): Promise<void> {
        await this.commentOnPullRequest(pullRequestId, 'Approved from Visual Studio Code', 'approved');
    }

    async mergePullRequest(pullRequestId: string | number): Promise<void> {
        const data = await this.post<{ executed?: boolean; failure_reason?: string; possible?: boolean }>(
            'merge_pull_request',
            { repoid: this.repoId, pullrequestid: pullRequestId },
        );
        this.throwIfError(data);
    }

    async closePullRequest(pullRequestId: string | number): Promise<void> {
        const data = await this.post<{ closed?: boolean }>('close_pull_request', {
            repoid: this.repoId,
            pullrequestid: pullRequestId,
        });
        this.throwIfError(data);
    }

    async createPullRequest(sourceRef: string, targetRef: string, name: string): Promise<void> {
        const data = await this.post<unknown>('create_pull_request', {
            source_repo: this.repoId,
            target_repo: this.repoId,
            source_ref: 'branch:' + sourceRef,
            target_ref: 'branch:' + targetRef,
            title: name,
        });
        this.throwIfError(data);
    }

    async getRepoRefs(): Promise<RepoRefs> {
        const data = await this.post<RepoRefs>('get_repo_refs', { repoid: this.repoId });
        this.throwIfError(data);
        return data.result!;
    }

    /**
     * All repository groups the user can read (get_repo_groups).
     * Also used as a cheap connection check (throws if the server or API
     * key is invalid).
     */
    async getRepoGroups(): Promise<RepoGroup[]> {
        const data = await this.post<RepoGroup[]>('get_repo_groups', {});
        this.throwIfError(data);
        const groups = data.result ?? [];
        logDebug(`get_repo_groups: returned ${groups.length} groups`);
        if (groups.length > 0) {
            const sample = groups
                .slice(0, 10)
                .map((g) => g.group_name)
                .join(', ');
            logDebug(`  First groups: ${sample}${groups.length > 10 ? ` (${groups.length - 10} more)` : ''}`);
        }
        return groups;
    }

    /**
     * All repositories the user can access (get_repos, traverse=true).
     * repo_name is the full path, e.g. "team/services/api".
     */
    async getRepos(): Promise<RepoInfo[]> {
        const data = await this.post<RepoInfo[]>('get_repos', {});
        this.throwIfError(data);
        const repos = data.result ?? [];
        logDebug(`get_repos: returned ${repos.length} repos`);
        if (repos.length > 0) {
            const sample = repos
                .slice(0, 10)
                .map((r) => r.repo_name)
                .join(', ');
            logDebug(`  First repos: ${sample}${repos.length > 10 ? ` (${repos.length - 10} more)` : ''}`);
        }
        return repos;
    }

    /**
     * Fetch the rendered pull request page HTML. RhodeCode web routes accept
     * the API key via the `api_key` query parameter, which is how we read the
     * full comment thread (the JSON-RPC API has no "list comments" method).
     */
    async getPullRequestPage(pullRequestId: string | number): Promise<string> {
        const url = `${this.serverUrl}/${encodeURIComponent(this.repoName)}/pull-request/${pullRequestId}?api_key=${encodeURIComponent(this.apiKey)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        let response: Response;
        try {
            response = await fetch(url, { signal: controller.signal });
        } catch (err) {
            throw new Error(`Could not fetch pull request page: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            clearTimeout(timer);
        }
        if (response.status !== 200) {
            throw new Error(`Pull request page returned HTTP ${response.status}`);
        }
        return await response.text();
    }

    pullRequestUrl(pullRequestId: string | number): string {
        return `${this.serverUrl}/${encodeURIComponent(this.repoName)}/pull-request/${pullRequestId}`;
    }

    changesetUrl(sha: string): string {
        return `${this.serverUrl}/${encodeURIComponent(this.repoName)}/changeset/${sha}`;
    }

    getServerUrl(): string {
        return this.serverUrl;
    }

    getApiKey(): string {
        return this.apiKey;
    }

    private throwIfError<T>(data: RhodeCodeResponse<T>): void {
        if (data.error) {
            throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
        }
    }
}

export function reportError(operation: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    window.showErrorMessage(`RhodeCode: ${operation} failed — ${message}`);
}
