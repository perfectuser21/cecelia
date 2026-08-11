import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function tokenFromEnvFile(filePath) {
  try {
    const line = readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .find((item) => item.startsWith('CECELIA_INTERNAL_TOKEN='));
    return line?.slice('CECELIA_INTERNAL_TOKEN='.length).trim() || null;
  } catch {
    return null;
  }
}

export function brainInternalAuthHeaders(env = process.env) {
  const token = env.CECELIA_INTERNAL_TOKEN?.trim() || tokenFromEnvFile(
    env.CECELIA_INTERNAL_ENV_FILE
      || join(homedir(), '.credentials', 'cecelia-internal.env'),
  );
  return token ? { Authorization: `Bearer ${token}` } : {};
}
