/** Local operator entry point. A Notion page supplies neither code nor file paths. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runStandaloneSkill } from './run.mjs';

export function readOwnedFile(path, { maxBytes = 1_048_576 } = {}) {
  if (!isAbsolute(path) || realpathSync(path) !== path) throw Error('standalone_file_path_invalid');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o022) || stat.size > maxBytes) {
    throw Error('standalone_file_untrusted');
  }
  return readFileSync(path);
}

export async function loadStandaloneProvider(configPath, context) {
  const config = JSON.parse(readOwnedFile(configPath));
  const bytes = readOwnedFile(config.provider);
  if (createHash('sha256').update(bytes).digest('hex') !== config.provider_sha256) {
    throw Error('standalone_provider_digest_mismatch');
  }
  const provider = await import(pathToFileURL(config.provider).href);
  return {...provider, ...(provider.createProvider ? {createProvider:job=>provider.createProvider(job,config.options,context)} : {})};
}

export async function launchStandaloneSkill(configPath) {
  const { identity, startHost, runAgent, verifyBusiness } = await loadStandaloneProvider(configPath);
  if (![startHost, runAgent, verifyBusiness].every(method => typeof method === 'function')) {
    throw Error('standalone_provider_invalid');
  }
  return runStandaloneSkill(identity, { startHost, runAgent, verifyBusiness });
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw Error('standalone_config_required');
    const receipt = await launchStandaloneSkill(process.argv[2]);
    process.stdout.write(JSON.stringify(receipt) + '\n');
    if (receipt.status !== 'completed') process.exitCode = 2;
  } catch (error) {
    const message = typeof error.message === 'string' && /^standalone_[a-z0-9_]+$/.test(error.message)
      ? error.message
      : 'standalone_launch_unconfirmed';
    process.stderr.write(JSON.stringify({ error: message }) + '\n');
    process.exitCode = 1;
  }
}
