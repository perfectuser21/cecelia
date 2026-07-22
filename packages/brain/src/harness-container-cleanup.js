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

async function killContainersByLabel(label, value, logScope) {
  if (!value) return { ok: true, matched: 0, killed: 0 };

  let containerIds;
  try {
    const stdout = await dockerCmd(['ps', '-q', '--filter', `label=${label}=${value}`]);
    containerIds = stdout.trim().split('\n').filter(Boolean);
  } catch (err) {
    console.warn(`[harness-container-cleanup] docker ps failed: ${err.message}`);
    return { ok: false, matched: 0, killed: 0 };
  }

  if (containerIds.length === 0) return { ok: true, matched: 0, killed: 0 };

  let killed = 0;
  for (const cid of containerIds) {
    try {
      await dockerCmd(['rm', '-f', cid]);
      killed++;
      console.log(`[harness-container-cleanup] killed ${cid} (${logScope}=${value})`);
    } catch (rmErr) {
      console.warn(`[harness-container-cleanup] rm -f ${cid} failed: ${rmErr.message}`);
    }
  }

  console.log(`[harness-container-cleanup] ${logScope}=${value} killed=${killed}/${containerIds.length} matched`);
  return { ok: killed === containerIds.length, matched: containerIds.length, killed };
}

/** Kill all running Docker containers whose cecelia.run_id label matches runId. */
export async function killInitiativeContainers(runId) {
  return killContainersByLabel('cecelia.run_id', runId, 'run');
}

/** Kill every old generation belonging to one attempt before watchdog resume. */
export async function killAttemptContainers(attemptId) {
  return killContainersByLabel('cecelia.attempt_id', attemptId, 'attempt');
}
