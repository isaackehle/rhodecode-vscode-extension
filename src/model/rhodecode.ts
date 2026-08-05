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

/** A comment parsed from the PR page HTML. */
export interface PullRequestComment {
    commentId: string;
    author: string;
    date: string;
    statusChange: string | null;
    text: string;
}
