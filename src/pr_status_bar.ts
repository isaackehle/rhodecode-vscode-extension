import * as vscode from 'vscode';
import { RhodeCodeClient } from './rhodecode_request';
import { getCurrentBranch } from './git_remote';
import { RhodeCodePullRequest } from './model/rhodecode';

/**
 * Status bar item for showing PR status of the current branch (issue #16).
 */
export class PRStatusBar {
    private readonly item: vscode.StatusBarItem;
    private readonly getClient: () => RhodeCodeClient | undefined;
    private currentBranch: string | undefined;
    private currentPR: RhodeCodePullRequest | undefined;

    constructor(getClient: () => RhodeCodeClient | undefined) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        this.item.command = 'rhodecode.openCurrentBranchPr';
        this.getClient = getClient;
        this.update();
    }

    dispose(): void {
        this.item.dispose();
    }

    /** Update the status bar based on current branch and PR status. */
    async update(): Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            this.item.hide();
            return;
        }

        const client = this.getClient();
        if (!client) {
            this.item.hide();
            return;
        }

        // Get current branch
        const branch = await getCurrentBranch(folder.uri.fsPath);
        if (!branch) {
            this.item.hide();
            return;
        }

        this.currentBranch = branch;

        // Skip default branches (they don't typically have their own PRs)
        if (this.isDefaultBranch(branch)) {
            this.item.hide();
            return;
        }

        // Fetch PRs and look for one from this branch
        try {
            // getPullRequests() (default status 'new') already returns open PRs.
            const prs = await client.getPullRequests();
            this.currentPR = prs.find((pr) => pr.source.reference.name === branch);
        } catch {
            this.currentPR = undefined;
        }

        if (this.currentPR) {
            // PR exists for this branch
            this.item.text = `$(git-pull-request) PR #${this.currentPR.pull_request_id}`;
            this.item.tooltip = `
Pull Request #${this.currentPR.pull_request_id}: ${this.currentPR.title}

Status: ${this.currentPR.status}
Review: ${this.currentPR.review_status}

Click to open in browser or select "Open in VS Code"
            `.trim();
            this.item.command = {
                command: 'rhodecode.openCurrentBranchPr',
                title: 'Open PR',
                arguments: [this.currentPR],
            };
            this.item.show();
        } else {
            // No PR for this branch - show create indicator
            this.item.text = `$(git-pull-request-create) No PR for ${branch}`;
            this.item.tooltip = `
No pull request found for branch "${branch}".

Click to create a new pull request.
            `.trim();
            this.item.command = {
                command: 'rhodecode.createPrForCurrentBranch',
                title: 'Create PR',
                arguments: [branch],
            };
            this.item.show();
        }
    }

    private isDefaultBranch(branch: string): boolean {
        const defaults = new Set(['master', 'main', 'trunk']);
        return defaults.has(branch.toLowerCase());
    }

    getCurrentBranch(): string | undefined {
        return this.currentBranch;
    }

    getCurrentPR(): RhodeCodePullRequest | undefined {
        return this.currentPR;
    }
}
