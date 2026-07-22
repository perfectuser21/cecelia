/**
 * harness-container-cleanup.js — initiative 终态容器清理
 *
 * initiative 变 failed/completed 时，主动 docker rm -f 所有关联容器。
 * kernel 容器通过 cecelia.run_id label 精确识别。
 */
import { execFile as execFileCb } from 'node:child_process';

function dockerCmd(args) {
  return new Promise((resolve, reject) => {
    execFileCb('docker', args, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout || '');
    });
  });
}

/**
 * Kill all running Docker containers whose cecelia.run_id label matches runId.
 *
 * @param {string} runId
 */
export async function killInitiativeContainers(runId) {
  if (!runId) return;

  let containerIds;
  try {
    const stdout = await dockerCmd(['ps', '-q', '--filter', `label=cecelia.run_id=${runId}`]);
    containerIds = stdout.trim().split('\n').filter(Boolean);
  } catch (err) {
    console.warn(`[harness-container-cleanup] docker ps failed: ${err.message}`);
    return;
  }

  if (containerIds.length === 0) return;

  let killed = 0;
  for (const cid of containerIds) {
    try {
      await dockerCmd(['rm', '-f', cid]);
      killed++;
      console.log(`[harness-container-cleanup] killed ${cid} (run=${runId})`);
    } catch (rmErr) {
      console.warn(`[harness-container-cleanup] rm -f ${cid} failed: ${rmErr.message}`);
    }
  }

  console.log(`[harness-container-cleanup] run=${runId} killed=${killed}/${containerIds.length} matched`);
}
