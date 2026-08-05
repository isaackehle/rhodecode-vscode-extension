import * as vscode from 'vscode';
import { RhodeCodeClient, reportError } from './rhodecoderequest';
import { PullRequestTreeProvider } from './pullRequestTreeProvider';
import { HandledStore } from './handledStore';
import { CommentViewProvider } from './commentViewProvider';
import { registerCommands } from './commands';

let client: RhodeCodeClient | undefined;
let tree: PullRequestTreeProvider | undefined;
let commentView: CommentViewProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
    const store = new HandledStore(context.workspaceState);

    client = undefined;
    tree = new PullRequestTreeProvider(() => client, store);
    commentView = new CommentViewProvider(() => client, tree);

    const treeView = vscode.window.createTreeView('rhodecode.pullRequests', {
        treeDataProvider: tree,
        showCollapseAll: false,
    });
    context.subscriptions.push(treeView);

    const setClient = (c: RhodeCodeClient | undefined): void => {
        client = c;
    };

    registerCommands(context, () => client, tree, commentView, setClient);

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('rhodecode')) {
                client = undefined;
                tree?.refresh();
                try {
                    await tree?.load();
                } catch (err) {
                    reportError('reload', err);
                }
            }
        }),
    );

    // Kick off an initial load so the view is populated when configured.
    void (async () => {
        try {
            client = await RhodeCodeClient.create();
            if (client && tree) {
                await tree.load();
            }
        } catch (err) {
            reportError('load', err);
        }
    })();
}

export function deactivate(): void {
    // nothing to clean up
}
