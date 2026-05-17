import { execSync } from 'child_process';

export const JOB_ID = 'docker-prune';
export const JOB_NAME = 'Docker 镜像清理';

function parseFreedBytes(output) {
  const match = output.match(/Total reclaimed space:\s*([\d.]+)\s*(B|KB|MB|GB)/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3 };
  return Math.round(value * (multipliers[unit] ?? 1));
}

export async function run() {
  try {
    const output = execSync('docker image prune -f', {
      encoding: 'utf8',
      timeout: 60000
    });
    execSync('docker container prune -f', { encoding: 'utf8', timeout: 30000 });
    return {
      status: 'success',
      output: output.trim().slice(0, 500),
      freed_bytes: parseFreedBytes(output)
    };
  } catch (err) {
    if (err.message.includes('command not found') || err.message.includes('Cannot connect')) {
      return { status: 'skipped', output: 'Docker 不可用: ' + err.message.slice(0, 100) };
    }
    return { status: 'failed', output: err.message.slice(0, 500) };
  }
}
