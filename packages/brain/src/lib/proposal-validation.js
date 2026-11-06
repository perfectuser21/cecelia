// Proposal validation contract; shared with the current apply path.
export const ALLOWED_CHANGE_TYPES = new Set([
  'create_task',
  'update_task',
  'set_focus',
  'add_dependency',
  'remove_dependency',
  'split_task',
  'merge_tasks',
]);
export const ALLOWED_TASK_FIELDS = new Set([
  'priority', 'next_run_at', 'scheduled_for', 'title', 'description',
  'goal_id', 'project_id', 'task_type', 'status',
]);
export const BULK_THRESHOLD = 5;

export function validateChange(change) {
  const errors = [];

  if (!change || typeof change !== 'object') {
    return { valid: false, errors: ['change must be an object'] };
  }

  if (!ALLOWED_CHANGE_TYPES.has(change.type)) {
    errors.push(`action type "${change.type}" not in whitelist. Allowed: ${[...ALLOWED_CHANGE_TYPES].join(', ')}`);
  }

  if (change.type === 'update_task' && change.fields) {
    for (const field of Object.keys(change.fields)) {
      if (!ALLOWED_TASK_FIELDS.has(field)) {
        errors.push(`field "${field}" not allowed for update_task`);
      }
    }
  }

  if (change.type === 'create_task') {
    if (!change.title) errors.push('create_task requires title');
    if (!change.project_id) errors.push('create_task requires project_id');
  }

  if (change.type === 'add_dependency' || change.type === 'remove_dependency') {
    if (!change.task_id) errors.push(`${change.type} requires task_id`);
    if (!change.depends_on_id) errors.push(`${change.type} requires depends_on_id`);
  }

  if (change.type === 'set_focus') {
    if (!change.objective_id) errors.push('set_focus requires objective_id');
  }

  return { valid: errors.length === 0, errors };
}

export function validateChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { valid: false, errors: ['changes must be a non-empty array'], requires_review: false };
  }

  const allErrors = [];
  for (let i = 0; i < changes.length; i++) {
    const result = validateChange(changes[i]);
    if (!result.valid) {
      allErrors.push(...result.errors.map(e => `changes[${i}]: ${e}`));
    }
  }

  const requires_review = changes.length > BULK_THRESHOLD;

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    requires_review,
  };
}
