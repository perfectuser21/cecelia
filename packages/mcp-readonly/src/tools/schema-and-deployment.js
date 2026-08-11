// schema_version.version 在 packages/brain/migrations/005_schema_version_and_config.sql
// 里定义为 VARCHAR(10)，不是整数列。裸的 MAX(version) 是按字符串字典序比较，
// packages/brain/src/selfcheck.js 里对同一张表做等价查询时特地加了
// `WHERE version ~ '^[0-9]{1,4}$'` 过滤 + parseInt，注释写明是为了"忽略脏数据"——
// 说明生产库里 version 列出现过非纯数字内容。这里对齐 selfcheck.js 的做法，
// 过滤非数字行后按数值排序取最大值，避免脏数据把 MAX() 结果带偏、或让调用方
// 拿到非数字类型的 current_version。
const SCHEMA_VERSION_SQL = `
  SELECT MAX(version::int) AS version
  FROM schema_version
  WHERE version ~ '^[0-9]{1,4}$'
`;

export async function getSchemaVersion(pool, queryFn) {
  const result = await queryFn(pool, SCHEMA_VERSION_SQL, []);
  return { current_version: result.rows[0].version };
}

export async function getDeploymentStatus(execFn, { startedAt }) {
  const shaResult = await execFn('git rev-parse --short HEAD');
  const branchResult = await execFn('git branch --show-current');
  return {
    commit_sha: shaResult.stdout.trim(),
    branch: branchResult.stdout.trim(),
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
  };
}
