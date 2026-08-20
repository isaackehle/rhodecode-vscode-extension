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
}

function buildGroupHierarchy(groups: RepoGroup[], _repos: RepoInfo[]): TestGroupNode[] {
    const groupMap = new Map<string, TestGroupNode>();
    const leafNameMap = new Map<string, TestGroupNode>();

    for (const group of groups) {
        const parts = group.group_name.split('/');
        const displayName = parts[parts.length - 1];
        const node: TestGroupNode = {
            group,
            displayName,
            parent: null,
            children: [],
            repos: [],
        };
        groupMap.set(group.group_name, node);

        const existingByLeaf = leafNameMap.get(displayName);
        if (existingByLeaf) {
            console.log(
                `buildGroupHierarchy: Duplicate leaf name "${displayName}" detected: existing="${existingByLeaf.group.group_name}", new="${group.group_name}"`,
            );
            // If existing is a subgroup (contains /), replace with top-level node
            if (existingByLeaf.group.group_name.includes('/')) {
                leafNameMap.set(displayName, node);
            }
        } else {
            leafNameMap.set(displayName, node);
        }
    }

    for (const [groupName, node] of groupMap) {
        const parts = groupName.split('/');
        if (parts.length > 1) {
            const parentName = parts.slice(0, -1).join('/');
            const parentNode = groupMap.get(parentName);
            if (parentNode) {
                const existingTopLevel = leafNameMap.get(node.displayName);
                if (existingTopLevel && existingTopLevel !== node && !existingTopLevel.parent) {
                    console.log(
                        `buildGroupHierarchy: Moving duplicate leaf "${node.displayName}" from top-level to under parent "${parentNode.displayName}"`,
                    );
                    // Link the top-level duplicate to the parent
                    existingTopLevel.parent = parentNode;
                    parentNode.children.push(existingTopLevel);
                    // Move any children of the subgroup to the moved top-level node
                    existingTopLevel.children.push(...node.children);
                    // Mark subgroup as having itself as parent (so it's not a root)
                    node.parent = node;
                    continue;
                }

                parentNode.children.push(node);
                node.parent = parentNode;
            }
        }
    }

    const rootNodes: TestGroupNode[] = [];
    for (const node of groupMap.values()) {
        if (node.parent === node) {
            // Skip self-referencing nodes (subgroups replaced by top-level duplicates)
            continue;
        }
        if (!node.parent || !groupMap.has(node.parent.group.group_name)) {
            rootNodes.push(node);
        }
    }

    return rootNodes.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

suite('Group Hierarchy with Duplicate Leaf Names', () => {
    suite('Duplicate leaf under parent (W case)', () => {
        test('moves top-level duplicate under parent when subgroup exists', () => {
            const groups: RepoGroup[] = [
                { group_id: 1, group_name: 'W', group_description: null, owner: null, parent_group: null },
                { group_id: 2, group_name: 'W_V', group_description: null, owner: null, parent_group: null },
                { group_id: 3, group_name: 'W/W_V', group_description: null, owner: null, parent_group: null },
                { group_id: 4, group_name: 'W_X', group_description: null, owner: null, parent_group: null },
                { group_id: 5, group_name: 'W/W_X', group_description: null, owner: null, parent_group: null },
            ];

            const rootNodes = buildGroupHierarchy(groups, []);

            // Should only have W as root (duplicates moved under it)
            assert.strictEqual(rootNodes.length, 1, 'Should have 1 root node (W)');
            assert.strictEqual(rootNodes[0].group.group_name, 'W');

            // Should have both duplicates as children (the top-level nodes moved under W)
            assert.strictEqual(rootNodes[0].children.length, 2, 'Should have 2 children under W');

            const childNames = rootNodes[0].children.map((c) => c.group.group_name);
            assert.ok(childNames.includes('W_V'), 'Should have W_V child (moved from top-level)');
            assert.ok(childNames.includes('W_X'), 'Should have W_X child (moved from top-level)');

            // Should NOT have top-level duplicates as separate roots (they should be children of W)
            const rootNames = rootNodes.map((r) => r.group.group_name);
            assert.ok(!rootNames.includes('W_V'), 'W_V should not be a root (moved under W)');
            assert.ok(!rootNames.includes('W_X'), 'W_X should not be a root (moved under W)');
        });
    });

    suite('Duplicate leaf order - subgroup comes first', () => {
        test('moves top-level duplicate under parent when subgroup is processed first', () => {
            const groups: RepoGroup[] = [
                { group_id: 1, group_name: 'W', group_description: null, owner: null, parent_group: null },
                { group_id: 2, group_name: 'W/W_V', group_description: null, owner: null, parent_group: null },
                { group_id: 3, group_name: 'W_V', group_description: null, owner: null, parent_group: null },
            ];

            const rootNodes = buildGroupHierarchy(groups, []);

            // Should only have W as root
            assert.strictEqual(rootNodes.length, 1, 'Should have 1 root node (W)');

            const childNames = rootNodes[0].children.map((c) => c.group.group_name);
            assert.ok(childNames.includes('W_V'), 'Should have W_V child (moved from top-level)');

            // The top-level duplicate should have been moved under W
            // Check that it's not a root (it should be a child of W)
            const allRootNames = rootNodes.map((r) => r.group.group_name);
            assert.ok(!allRootNames.includes('W_V'), 'Top-level duplicate should not be a root');
        });
    });

    suite('No duplicates - normal hierarchy', () => {
        test('preserves normal group hierarchy without duplicates', () => {
            const groups: RepoGroup[] = [
                { group_id: 1, group_name: 'team', group_description: null, owner: null, parent_group: null },
                { group_id: 2, group_name: 'team/services', group_description: null, owner: null, parent_group: null },
                {
                    group_id: 3,
                    group_name: 'team/services/api',
                    group_description: null,
                    owner: null,
                    parent_group: null,
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

    suite('Mixed duplicates and normal hierarchy', () => {
        test('handles both duplicate and non-duplicate groups correctly', () => {
            const groups: RepoGroup[] = [
                { group_id: 1, group_name: 'V', group_description: null, owner: null, parent_group: null },
                { group_id: 2, group_name: 'V/X', group_description: null, owner: null, parent_group: null },
                { group_id: 3, group_name: 'V/Y', group_description: null, owner: null, parent_group: null },
                { group_id: 4, group_name: 'V/X/Y', group_description: null, owner: null, parent_group: null },
                { group_id: 5, group_name: 'Z', group_description: null, owner: null, parent_group: null },
            ];

            const rootNodes = buildGroupHierarchy(groups, []);

            // Should have 2 roots: V and Z
            assert.strictEqual(rootNodes.length, 2, 'Should have 2 root nodes (V and Z)');

            const rootNames = rootNodes.map((r) => r.group.group_name);
            assert.ok(rootNames.includes('V'), 'Should have V as root');
            assert.ok(rootNames.includes('Z'), 'Should have Z as root');

            // V should have X as child
            const vNode = rootNodes.find((r) => r.group.group_name === 'V');
            assert.ok(vNode, 'Should find V node');
            const xChildNames = vNode!.children.map((c) => c.group.group_name);
            assert.ok(xChildNames.includes('V/X'), 'V should have V/X as child');

            // V/X should have Y as child (duplicate moved under it)
            const xNode = vNode!.children.find((c) => c.group.group_name === 'V/X');
            assert.ok(xNode, 'Should find V/X node');
            const yChildNames = xNode!.children.map((c) => c.group.group_name);
            assert.ok(yChildNames.includes('V/X/Y'), 'V/X should have V/X/Y as child');
        });
    });

    suite('Empty groups', () => {
        test('handles empty groups array', () => {
            const rootNodes = buildGroupHierarchy([], []);
            assert.strictEqual(rootNodes.length, 0, 'Should have 0 root nodes');
        });
    });

    suite('Deep hierarchy - 3 levels', () => {
        test('handles A/A_B/A_B_C correctly', () => {
            const groups: RepoGroup[] = [
                { group_id: 1, group_name: 'A', group_description: null, owner: null, parent_group: null },
                { group_id: 2, group_name: 'A_B', group_description: null, owner: null, parent_group: null },
                { group_id: 3, group_name: 'A/A_B', group_description: null, owner: null, parent_group: null },
                { group_id: 4, group_name: 'A_B_C', group_description: null, owner: null, parent_group: null },
                { group_id: 5, group_name: 'A/A_B/A_B_C', group_description: null, owner: null, parent_group: null },
            ];

            const rootNodes = buildGroupHierarchy(groups, []);

            // Should have 1 root: A
            assert.strictEqual(rootNodes.length, 1, 'Should have 1 root node (A)');
            assert.strictEqual(rootNodes[0].group.group_name, 'A');

            // A -> A_B (A_B moved from top-level under A)
            assert.strictEqual(rootNodes[0].children.length, 1, 'A should have 1 child');
            assert.strictEqual(rootNodes[0].children[0].group.group_name, 'A_B');
        });
    });
});
