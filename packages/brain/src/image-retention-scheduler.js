import { runJob, reconcileJob } from './janitor.js';
import { IMAGE_RETENTION_POLICY } from './image-retention-authority.js';
export async function runImageRetentionJanitor(pool) {
  try {
    // 即使停用仍可只读回执收口旧running；绝不重发execute。
    const reconciled = await reconcileJob(pool, IMAGE_RETENTION_POLICY);
    if (reconciled.status !== 'idle') return reconciled;
    return await runJob(pool, IMAGE_RETENTION_POLICY);
  } catch (error) {
    if (['JANITOR_DISABLED', 'JANITOR_BUSY', 'JANITOR_UNCONFIRMED'].includes(error.code)) return { status: error.code };
    throw error;
  }
}
