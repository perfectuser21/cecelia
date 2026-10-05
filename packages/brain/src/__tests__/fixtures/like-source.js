/**
 * 迁移 520 起 journey_steps / journey_step_links 在 public 里是兼容视图（真表 activities / activity_cells）。
 * 夹具用 `CREATE TABLE x (LIKE public.<t> INCLUDING ALL)` 复制结构时，LIKE 一个视图拿不到主键/唯一索引，
 * 后续重放迁移里 `REFERENCES journey_steps(id)` 会报"没有唯一约束"。这里把旧名映射到真表；第二段切完代码后随旧名一起删。
 */
export const TABLE_SOURCE = Object.freeze({ journey_steps: 'activities', journey_step_links: 'activity_cells', enablers: 'warehouse_items' });
export const likeSource = (table) => TABLE_SOURCE[table] ?? table;
