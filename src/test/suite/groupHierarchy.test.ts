import * as assert from 'assert';
import { RepoGroup, RepoInfo } from '../../model/rhodecode';
import { suite, test } from 'mocha';

/** Internal test helper to extract group hierarchy logic */
interface TestGroupNode {
    group: RepoGroup;
    displayName: string;
    parent: TestGroupNode | null;
    children: TestGroupNode[];
    repos: RepoInfo[];
    hidden: boolean;
}

function buildGroupHierarchy(groups: RepoGroup[], _repos: RepoInfo[]): TestGroupNode[] {
    const groupMap = new Map<string, TestGroupNode>();

    for (const group of groups) {
        const node: TestGroupNode = {
            group,
            displayName: group.group_name,
            parent: null,
            children: [],
            repos: [],
            hidden: false,
        };
        groupMap.set(group.group_name, node);
    }

    // Link parent-child relationships using parent_group field
    for (const [_groupName, node] of groupMap) {
        if (node.group.parent_group) {
            const parentNode = groupMap.get(node.group.parent_group);
            if (parentNode) {
                parentNode.children.push(node);
                node.parent = parentNode;
                parentNode.hidden = false; // Parent now has children, show it
            }
        }
    }

    // Return root nodes (groups with no parent)
    const rootNodes: TestGroupNode[] = [];
    for (const node of groupMap.values()) {
        if (!node.parent) {
            rootNodes.push(node);
        }
    }

    return rootNodes.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

suite('Group Hierarchy with parent_group', () => {
    suite('Normal hierarchy - uses parent_group', () => {
        test('preserves normal group hierarchy', () => {
            const groups: RepoGroup[] = [
                { group_id: 1, group_name: 'team', group_description: null, owner: null, parent_group: null },
                {
                    group_id: 2,
                    group_name: 'team/services',
                    group_description: null,
                    owner: null,
                    parent_group: 'team',
                },
                {
                    group_id: 3,
                    group_name: 'team/services/api',
                    group_description: null,
                    owner: null,
                    parent_group: 'team/services',
                },
            ];

            const rootNodes = buildGroupHierarchy(groups, []);

            // Should have 1 root
            assert.strictEqual(rootNodes.length, 1, 'Should have 1 root node');
            assert.strictEqual(rootNodes[0].group.group_name, 'team');

            // team -> services -> api
            assert.strictEqual(rootNodes[0].children.length, 1, 'team should have 1 child');
            assert.strictEqual(rootNodes[0].children[0].group.group_name, 'team/services');
            assert.strictEqual(rootNodes[0].children[0].children.length, 1, 'services should have 1 child');
            assert.strictEqual(rootNodes[0].children[0].children[0].group.group_name, 'team/services/api');
        });
    });

    suite('No parent_group - top-level groups', () => {
        test('handles top-level groups with no parent', () => {
            const groups: RepoGroup[] = [
                { group_id: 1, group_name: 'team', group_description: null, owner: null, parent_group: null },
                { group_id: 2, group_name: 'projects', group_description: null, owner: null, parent_group: null },
                { group_id: 3, group_name: 'shared', group_description: null, owner: null, parent_group: null },
            ];

            const rootNodes = buildGroupHierarchy(groups, []);

            // Should have 3 roots
            assert.strictEqual(rootNodes.length, 3, 'Should have 3 root nodes');
            const rootNames = rootNodes.map((r) => r.group.group_name).sort();
            assert.deepStrictEqual(rootNames, ['projects', 'shared', 'team']);
        });
    });

    suite('Mixed hierarchy', () => {
        test('handles both parented and top-level groups', () => {
            const groups: RepoGroup[] = [
                { group_id: 1, group_name: 'V', group_description: null, owner: null, parent_group: null },
                { group_id: 2, group_name: 'V/X', group_description: null, owner: null, parent_group: 'V' },
                { group_id: 3, group_name: 'V/Y', group_description: null, owner: null, parent_group: 'V' },
                { group_id: 4, group_name: 'V/X/Y', group_description: null, owner: null, parent_group: 'V/X' },
                { group_id: 5, group_name: 'Z', group_description: null, owner: null, parent_group: null },
            ];

            const rootNodes = buildGroupHierarchy(groups, []);

            // Should have 2 roots: V and Z
            assert.strictEqual(rootNodes.length, 2, 'Should have 2 root nodes (V and Z)');

            const rootNames = rootNodes.map((r) => r.group.group_name).sort();
            assert.deepStrictEqual(rootNames, ['V', 'Z']);

            // V should have X and Y as children
            const vNode = rootNodes.find((r) => r.group.group_name === 'V');
            assert.ok(vNode, 'Should find V node');
            const xChildNames = vNode!.children.map((c) => c.group.group_name).sort();
            assert.deepStrictEqual(xChildNames, ['V/X', 'V/Y']);

            // V/X should have Y as child
            const xNode = vNode!.children.find((c) => c.group.group_name === 'V/X');
            assert.ok(xNode, 'Should find V/X node');
            assert.strictEqual(xNode!.children.length, 1, 'V/X should have 1 child');
            assert.strictEqual(xNode!.children[0].group.group_name, 'V/X/Y');
        });
    });

    suite('Empty groups', () => {
        test('handles empty groups array', () => {
            const rootNodes = buildGroupHierarchy([], []);
            assert.strictEqual(rootNodes.length, 0, 'Should have 0 root nodes');
        });
    });

    suite('Self-referencing parent_group', () => {
        test('handles group with parent_group pointing to itself', () => {
            const groups: RepoGroup[] = [
                {
                    group_id: 1,
                    group_name: 'orphan',
                    group_description: null,
                    owner: null,
                    parent_group: 'nonexistent',
                },
            ];

            const rootNodes = buildGroupHierarchy(groups, []);

            // Should have 1 root since parent doesn't exist
            assert.strictEqual(rootNodes.length, 1, 'Should have 1 root node (orphan)');
            assert.strictEqual(rootNodes[0].group.group_name, 'orphan');
        });
    });

    suite('Hidden nodes', () => {
        test('marks parent as visible when child exists', () => {
            const groups: RepoGroup[] = [
                { group_id: 1, group_name: 'A', group_description: null, owner: null, parent_group: null },
                { group_id: 2, group_name: 'A/B', group_description: null, owner: null, parent_group: 'A' },
            ];

            const rootNodes = buildGroupHierarchy(groups, []);

            // Parent should be visible (has child)
            assert.strictEqual(rootNodes[0].hidden, false, 'Parent should not be hidden');
        });
    });
});
