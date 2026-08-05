export interface RhodeCodeResponse<T> {
    id: string | number;
    result: T | null;
    error: string | null;
}

export interface Mergeable {
    status: string;
    message: string;
}

export interface Reference {
    name: string;
    type: string;
    commit_id: string;
}

export interface ReferenceSource {
    clone_url: string;
    repository?: string;
    reference: Reference;
}

export interface Author {
    username?: string;
    full_name?: string;
    email?: string;
    [key: string]: unknown;
}

export interface Reviewer {
    user: Author;
    review_status: string;
}

export interface RhodeCodePullRequest {
    pull_request_id: string | number;
    url: string;
    title: string;
    description: string;
    status: string;
    created_on: string;
    updated_on: string;
    commit_ids: string[];
    review_status: string;
    mergeable: Mergeable;
    source: ReferenceSource;
    target: ReferenceSource;
    author: Author;
    reviewers: Reviewer[];
}

export interface RepoRefs {
    bookmarks: Record<string, string>;
    branches: Record<string, string>;
    branches_closed: Record<string, string>;
    tags: Record<string, string>;
}

export interface CommentResult {
    pull_request_id: string | number;
    comment_id: string | number;
    status: string | null;
}

/** A comment parsed from the PR page HTML (fallback path). */
export interface PullRequestComment {
    commentId: string;
    author: string;
    date: string;
    statusChange: string | null;
    text: string;
    /** 'todo' when this comment is a task, 'note' or null otherwise. */
    commentType: 'todo' | 'note' | null;
    /** True when the task comment has been resolved. */
    resolved: boolean;
}

/* ------------------------------------------------------------------ */
/* Modern API shapes (RhodeCode 4.6+, get_pull_request_comments)       */
/* ------------------------------------------------------------------ */

export interface CommentAuthor {
    username: string;
    full_name_or_username: string;
    active: boolean;
}

export interface CommentStatus {
    status: string;
    status_lbl: string;
}

export interface PullRequestCommentData {
    comment_id: number;
    comment_type: 'note' | 'todo' | null;
    comment_text: string;
    comment_status: CommentStatus | Record<string, never>;
    comment_f_path: string | null;
    comment_lineno: string | null;
    comment_author: CommentAuthor;
    comment_created_on: string;
    /** Set (the resolving comment) when this todo has been resolved. */
    comment_resolved_by: unknown | null;
    comment_commit_id: string | null;
    comment_pull_request_id: number;
    comment_last_version: number;
    pull_request_version: string | null;
}

