// self-check.js — 启动自检：确认 mcp_readonly 账号真的只读。
//
// 背景：mcp-readonly 服务的整套安全模型建立在"这个 DB 账号只能 SELECT"这个假设上
// （见 packages/brain/scripts/setup-mcp-readonly-role.sql）。但角色权限是运维手动
// 跑一次性脚本配的，跟代码不是同一条部署链路——账号被误配成可写（脚本没跑、跑错
// 了库、后来被人手动 GRANT 回写权限）不会在编译期或类型层面暴露，只会在 Notion AI
// 通过这个"只读"服务真的执行了一条写操作时才炸出来。所以在服务启动时主动探测一次，
// 账号意外可写就拒绝启动，比事后审计更可靠。
//
// 设计取舍——为什么不用"真的 INSERT 一下再回滚"这种探测方式：
// 最初的参考实现是 `DO $$ BEGIN CREATE TEMP TABLE ...; INSERT ...; ROLLBACK; ...
// EXCEPTION WHEN insufficient_privilege THEN RAISE; END $$`，实测（本机 cecelia_test +
// 真实 mcp_readonly 角色）发现这个写法有两个独立的真实缺陷，不是"理论上可能"：
//
// 1) 语法层面：PL/pgSQL 的 DO 块内部不能执行 ROLLBACK —— DO 块是在当前事务的一个
//    隐式子事务里跑的，块内 ROLLBACK 会报 "cannot roll back while a subtransaction
//    is active"，跟账号是否只读完全无关。用 mcp_readonly 和 owner 账号各测一遍，
//    两边报的是同一个错——如果 catch 逻辑只按"报错就当预期的权限不足"来判断，这个
//    语法错误会被误判成"自检通过"，完全没测出账号是不是真的只读。
//
// 2) 语义层面（比 1 更根本，光改 ROLLBACK 语法解决不了）：CREATE TEMP TABLE 建出来
//    的表，创建者自动是这张表的 owner，而对象 owner 天然拥有该对象的全部权限
//    （INSERT/UPDATE/DELETE/DROP），跟这个角色在库/schema 级别被 GRANT 了什么完全
//    无关。实测证实：mcp_readonly 对自己刚建的临时表执行 INSERT 会成功（因为它是
//    owner），但对真正被 GRANT SELECT-only 的生产表（如 schema_version）执行 INSERT
//    会正确报 permission denied。也就是说"建一张临时表再试着写它"这种探测方式，
//    无论账号权限配置成什么样，探测结果永远是"能写"——测的是错误的东西。
//
// 改用方案：不做任何真实 DML 尝试，改用 PostgreSQL 权限目录内省函数
// has_table_privilege() 直接问"这个角色对这张表有没有 INSERT/UPDATE/DELETE 权限"。
// 好处：
//   - 零副作用——纯读权限目录，不产生任何数据变更，不需要 ROLLBACK，不用担心探测
//     语句本身失败导致脏数据残留在生产表里。
//   - 不依赖任何生产表的列结构（不用知道 schema_version 有哪些列、类型是什么），
//     换探测目标表或生产表加了新列都不需要改这段代码。
//   - 探测结果是明确的布尔值，不是"catch 到了某个字符串就当预期"这种脆弱的错误
//     分类——彻底消灭了"没法区分预期的权限不足 vs 意外的其他错误"这个问题：
//     现在只要 queryFn 抛出任何异常（网络问题、语法错误、目标表不存在……），
//     一律代表探测本身出了意外，直接原样向上抛出，不再需要判断"这个异常算不算
//     预期"，因为预期的信号已经改用返回值表达，不再需要靠异常表达。
//
// 检查覆盖 setup-mcp-readonly-role.sql 里实际 GRANT SELECT 的全部 5 张表（逐表单独
// GRANT，不是 schema 级别的一揽子授权，所以理论上可能出现"这张表配对了、那张表配
// 漏了"的局部误配置）——bool_or 聚合成一次往返查询，只要其中任何一张表出现意外
// 写权限就判定为"账号权限配置错误"。
const PROTECTED_TABLES = [
  'schema_version',
  'map_manifest_versions',
  'map_projection_runs',
  'map_projection_nodes',
  'map_projection_edges',
];

const WRITE_PRIVILEGE_PROBE_SQL = `
  SELECT bool_or(has_table_privilege(current_user, t, 'INSERT,UPDATE,DELETE')) AS can_write
  FROM (VALUES ${PROTECTED_TABLES.map((t) => `('${t}')`).join(', ')}) AS tables(t);
`;

export async function assertReadonly(queryFn) {
  // queryFn 抛出的任何异常都视为探测本身失败（连接问题/语法错误/目标表不存在等），
  // 不吞掉、不当成"自检通过"，原样向上抛出让启动失败并暴露真实原因。
  const result = await queryFn(WRITE_PRIVILEGE_PROBE_SQL);
  const canWrite = result?.rows?.[0]?.can_write;

  if (typeof canWrite !== 'boolean') {
    // 查询"成功"了，但返回形状不是预期的布尔值——同样不能当成"自检通过"，
    // 这代表探测语句本身或返回值解析出了没预料到的状况，必须 fail closed。
    throw new Error(
      `账号权限自检返回了非预期结果，无法判定 mcp_readonly 是否只读，拒绝启动：${JSON.stringify(result?.rows)}`
    );
  }

  if (canWrite) {
    throw new Error('账号权限配置错误：mcp_readonly 角色意外拥有写权限，拒绝启动');
  }
  // canWrite === false：确认账号对全部受保护表都没有 INSERT/UPDATE/DELETE 权限，自检通过。
}
