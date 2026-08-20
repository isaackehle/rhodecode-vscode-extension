// Tests for PR action button functionality (Issues #33 and #34)
import * as assert from 'assert';
import * as vscode from 'vscode';
import { PRActionItem } from '../../pull_request_tree_provider';

suite('PRActionItem', () => {
    test('creates open action item with correct properties', () => {
        const item = new PRActionItem('open', 'feature-branch');
        assert.strictEqual(item.id, 'pr-action-open');
        assert.strictEqual(item.contextValue, 'pr-action');
        assert.strictEqual(item.label, 'Open PR in Browser');
        assert.strictEqual(item.description, 'for "feature-branch"');
        assert.ok(item.iconPath instanceof vscode.ThemeIcon);
        assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'globe');
        const tooltip = typeof item.tooltip === 'string' ? item.tooltip : String(item.tooltip);
        assert.ok(tooltip.includes('feature-branch'));
        assert.ok(tooltip.includes('browser'));
    });

    test('creates create action item with correct properties', () => {
        const item = new PRActionItem('create', 'feature-branch');
        assert.strictEqual(item.id, 'pr-action-create');
        assert.strictEqual(item.contextValue, 'pr-action');
        assert.strictEqual(item.label, 'Create PR');
        assert.strictEqual(item.description, 'for "feature-branch"');
        assert.ok(item.iconPath instanceof vscode.ThemeIcon);
        assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'plus');
        const tooltip = typeof item.tooltip === 'string' ? item.tooltip : String(item.tooltip);
        assert.ok(tooltip.includes('feature-branch'));
        assert.ok(tooltip.includes('new pull request'));
    });

    test('has no command assigned', () => {
        const item = new PRActionItem('open', 'test-branch');
        assert.strictEqual(item.command, undefined);
    });
});

suite('Tree Item Commands - Issue #34', () => {
    test('RefItem has no command', () => {
        const { RefItem } = require('../../pull_request_tree_provider');
        const branchItem = new RefItem('branch', 'main', 'abc123');
        assert.strictEqual(branchItem.command, undefined);

        const tagItem = new RefItem('tag', 'v1.0.0', 'def456');
        assert.strictEqual(tagItem.command, undefined);
    });

    test('GroupItem has no command', () => {
        const { GroupItem } = require('../../pull_request_tree_provider');
        const group = { group_id: 1, group_name: 'test-group', group_description: 'Test group' };
        const groupItem = new GroupItem(group, 5, false);
        assert.strictEqual(groupItem.command, undefined);
    });

    test('RepoItem has no command', () => {
        const { RepoItem } = require('../../pull_request_tree_provider');
        const repo = {
            repo_id: 1,
            repo_name: 'test-repo',
            repo_type: 'repository',
            clone_uri: 'git@example.com:repo.git',
        };
        const repoItem = new RepoItem(repo);
        assert.strictEqual(repoItem.command, undefined);
    });

    test('PullRequestItem still has command', () => {
        const { PullRequestItem } = require('../../pull_request_tree_provider');
        const pr = {
            pull_request_id: 1,
            title: 'Test PR',
            status: 'new',
            review_status: 'under_review',
            source: { reference: { name: 'feature' } },
            target: { reference: { name: 'main' } },
            description: 'Test description',
        };
        const prItem = new PullRequestItem(pr);
        assert.ok(prItem.command);
        assert.strictEqual(prItem.command.command, 'rhodecode.showComments');
    });
});
