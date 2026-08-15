export const MAP_SCOPE_VALIDATION_VERSION = 'active-business-node-v1';

const ACTIVE_TASK_STATUSES = new Set(['queued', 'in_progress']);

export function assertRouteSnapshotLaunchAuthority({
  taskStatus,
  validationVersion,
  hasV2Run,
}) {
  if (
    ACTIVE_TASK_STATUSES.has(taskStatus)
    && validationVersion !== MAP_SCOPE_VALIDATION_VERSION
    && hasV2Run !== true
  ) {
    const error = new Error('legacy_route_snapshot_unvalidated');
    error.code = 'legacy_route_snapshot_unvalidated';
    throw error;
  }
  return true;
}
