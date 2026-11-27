/** Static tick ownership only; readiness, priority and resource gates stay with callers. */
export function tickTaskOwnershipSql(alias, excludedTypesParameter) {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)
      || !Number.isInteger(excludedTypesParameter) || excludedTypesParameter < 1) {
    throw Error('unsafe tick task ownership SQL input');
  }
  return `${alias}.claimed_by IS NULL
      AND NOT COALESCE(${alias}.payload ? 'common_runner', false)
      AND COALESCE(${alias}.payload->>'headed_manual', 'false') <> 'true'
      AND COALESCE(${alias}.payload->>'parallel_worker', 'false') <> 'true'
      AND NOT (${alias}.task_type = ANY($${excludedTypesParameter}::text[]))`;
}
