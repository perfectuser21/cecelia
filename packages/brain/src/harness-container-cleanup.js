/**
 * harness-container-cleanup.js — initiative 终态容器清理
 *
 * initiative 变 failed/completed 时，主动 docker rm -f 所有关联容器。
 * 容器通过 HARNESS_INITIATIVE_ID env var 识别（容器无 --label 时的替代方案）。
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
 * Kill all running Docker containers whose HARNESS_INITIATIVE_ID env var
 * matches the given initiativeId.
 *
 * @param {string} initiativeId
 */
export async function killInitiativeContainers(initiativeId) {
  if (!initiativeId) return;

  let containerIds;
  try {
    const stdout = await dockerCmd(['ps', '-q']);
    containerIds = stdout.trim().split('\n').filter(Boolean);
  } catch (err) {
    console.warn(`[harness-container-cleanup] docker ps failed: ${err.message}`);
    return;
  }

  if (containerIds.length === 0) return;

  let killed = 0;
  for (const cid of containerIds) {
    try {
      const envOut = await dockerCmd([
        'inspect', '--format', '{{range .Config.Env}}{{.}}\n{{end}}', cid,
      ]);
      if (envOut.includes(`HARNESS_INITIATIVE_ID=${initiativeId}`)) {
        try {
          await dockerCmd(['rm', '-f', cid]);
          killed++;
          console.log(`[harness-container-cleanup] killed ${cid} (initiative=${initiativeId})`);
        } catch (rmErr) {
          console.warn(`[harness-container-cleanup] rm -f ${cid} failed: ${rmErr.message}`);
        }
      }
    } catch {
      // container exited between ps and inspect — ignore
    }
  }

  console.log(`[harness-container-cleanup] initiative=${initiativeId} killed=${killed}/${containerIds.length} scanned`);
}
