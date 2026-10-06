import { describe, it, expect } from 'vitest';
import { TREE_NODES_SQL, treeNodes, treeNodeTable } from '../tree-nodes-sql.js';

describe('tree-nodes-sql', () => {
  it('混查片段只读两张子表，不出现 journeys 父表', () => {
    expect(TREE_NODES_SQL).toMatch(/FROM value_streams UNION ALL SELECT \* FROM capabilities/);
    expect(TREE_NODES_SQL).not.toMatch(/journeys/);
  });

  it('treeNodes 给片段加别名', () => {
    expect(treeNodes('j')).toBe(`${TREE_NODES_SQL} j`);
  });

  it('treeNodeTable 按 parent_journey_id 分流：空=价值流，有=能力', () => {
    expect(treeNodeTable(null)).toBe('value_streams');
    expect(treeNodeTable(undefined)).toBe('value_streams');
    expect(treeNodeTable('00000000-0000-0000-0000-000000000001')).toBe('capabilities');
  });
});
