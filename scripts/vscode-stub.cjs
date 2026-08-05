// Minimal 'vscode' stub used by test-extension-load.cjs to load the compiled
// extension module graph the same way the VS Code extension host does.
// Only needs to survive module-load-time evaluation (no actual API calls).
const noop = () => {};
const noopObj = () => ({ dispose: noop });
const noopEmitter = () => ({ dispose: noop, event: noop });

module.exports = new Proxy(
    {
        window: {
            createTreeView: noopObj,
            createStatusBarItem: () => ({ show: noop, text: '', tooltip: '', command: '' }),
            registerWebviewViewProvider: noopObj,
            registerTreeDataProvider: noop,
            showInformationMessage: noop,
            showErrorMessage: noop,
            showWarningMessage: noop,
            showInputBox: () => Promise.resolve(undefined),
            showQuickPick: () => Promise.resolve(undefined),
            createOutputChannel: () => ({ appendLine: noop, show: noop, dispose: noop }),
            createWebviewPanel: noopObj,
            registerUriHandler: noopObj,
            onDidChangeActiveColorTheme: noopEmitter,
        },
        workspace: {
            getConfiguration: () => ({ get: () => undefined, update: () => Promise.resolve() }),
            workspaceFolders: [],
            onDidChangeConfiguration: noopEmitter,
            getWorkspaceFolder: () => undefined,
            fs: { readFile: () => Promise.resolve(new Uint8Array()), readFileSync: () => '' },
        },
        commands: {
            registerCommand: noopObj,
            executeCommand: () => Promise.resolve(),
        },
        Uri: {
            file: (p) => ({ fsPath: p, scheme: 'file', toString: () => 'file://' + p }),
            parse: (s) => ({ fsPath: s, scheme: 'file', toString: () => s }),
        },
        EventEmitter: class {
            event = noop;
            fire = noop;
            dispose = noop;
        },
        TreeItem: class {
            constructor(label) {
                this.label = label;
            }
        },
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        ThemeIcon: class {
            constructor(id) {
                this.id = id;
            }
        },
        StatusBarAlignment: { Left: 1, Right: 2 },
        ViewColumn: { One: 1, Two: 2 },
        WorkspaceConfiguration: class {},
        SecretStorage: class {},
        Memento: class {},
        CancellationTokenSource: class {
            token = { isCancellationRequested: false };
            cancel = noop;
            dispose = noop;
        },
        ProgressLocation: { Notification: 15, Window: 10 },
        l10n: { t: (s) => s },
        MarkdownString: class {
            constructor(v) {
                this.value = v;
            }
        },
        Disposable: class {
            dispose = noop;
        },
    },
    {
        // Anything else referenced at load time becomes a no-op callable.
        get(target, prop) {
            if (prop in target) return target[prop];
            return noop;
        },
    }
);
