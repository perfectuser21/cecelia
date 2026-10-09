/**
 * 价值流 / 能力两种树节点的混查片段（树+仓库 v3.0 第 6 刀，任务 49d057f1）。
 * journeys 父表退场后，凡"拿一个 id 可能是价值流也可能是能力"的读者用它当子查询：
 *   `SELECT j.name FROM ${TREE_NODES_SQL} j WHERE j.id = $1`
 * 单一类型的读者不要用它，直接读 value_streams（顶层）或 capabilities（挂在价值流下）。
 * 两张子表列完全一致，所以 SELECT * 可直接合并。
 */
export const TREE_NODES_SQL = '(SELECT * FROM value_streams UNION ALL SELECT * FROM capabilities)';

/** 带别名的写法，省得每处自己拼括号。 */
export function treeNodes(alias) {
  return `${TREE_NODES_SQL} ${alias}`;
}

/** 按角色选写入目标表：parent_journey_id 为空是价值流，否则是能力。 */
export function treeNodeTable(parentJourneyId) {
  return parentJourneyId == null ? 'value_streams' : 'capabilities';
}
