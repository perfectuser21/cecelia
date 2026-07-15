/**
 * db/pool.js — 重导出 pool 实例（供单元测试 vi.mock 精确路径使用）
 * task_id: c11cdec4-c845-447f-80da-9d528753be1d
 *
 * 实际 pool 实例在 ../db.js 初始化。
 * 本文件作为 mock 入口，使 vi.mock('...db/pool.js') 能精确拦截。
 */
export { default, pool } from '../db.js';
