export interface BranchAheadState {
    readonly branch: string | undefined;
    readonly ahead: number | undefined;
    readonly hasUpstream: boolean;
}

/**
 * A push is detected between two observations of the same branch's HEAD when
 * it now matches its upstream (ahead === 0) and either:
 *   - it had unpushed commits before (ahead > 0), and now doesn't — a normal
 *     or force push of an already-tracked branch, or
 *   - it had no upstream before and has one now — the first push of a new
 *     branch (`git push -u`), which is the most common trigger in practice.
 *
 * Comparisons across different branches (e.g. the user switched branches
 * rather than pushing) never count, even if the raw ahead counts happen to
 * line up.
 */
export function isPushTransition(previous: BranchAheadState | undefined, current: BranchAheadState): boolean {
    if (!previous || !current.branch || previous.branch !== current.branch || current.ahead !== 0) {
        return false;
    }
    const hadUnpushedCommits = previous.ahead !== undefined && previous.ahead > 0;
    const justPublished = !previous.hasUpstream && current.hasUpstream;
    return hadUnpushedCommits || justPublished;
}
