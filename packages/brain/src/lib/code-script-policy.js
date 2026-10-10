/** 中央代码选择唯一判据：JSON false + 存在且 active 的正式 Workflow。 */
export function deterministicScriptSql(alias) {
  if (!/^[a-z_]+$/.test(alias)) throw new Error('unsafe table alias');
  return `COALESCE((${alias}.task_type = 'script_run'
    AND ${alias}.payload->'runtime_requires_llm' = 'false'::jsonb
    AND EXISTS (SELECT 1 FROM workflows workflow
      WHERE workflow.id::text = ${alias}.payload->>'workflow_id'
        AND workflow.status = 'active')), false)`;
}
