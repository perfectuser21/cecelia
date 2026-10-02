export const IMAGE_RETENTION_AUTHORITY = Symbol('us-image-retention-controller');
export const IMAGE_RETENTION_POLICY = 'us-brain-image-retention-v1';
export const IMAGE_RETENTION_MACHINE = '1a379d80-ad36-47d3-88ba-e545ab299a54';
export function assertImageRetentionAuthority(request, context = {}) {
  if (context.imageRetentionAuthority !== IMAGE_RETENTION_AUTHORITY || request.requested_task_type !== 'janitor'
      || request.task?.executor_kind !== 'image-janitor' || request.declared_domain !== 'operations'
      || request.mutation_intent !== 'write' || request.source !== 'scheduler'
      || request.metadata?.policy !== IMAGE_RETENTION_POLICY || request.metadata?.machine_registry_id !== IMAGE_RETENTION_MACHINE) {
    throw new Error('janitor_authority_required');
  }
  return true;
}
