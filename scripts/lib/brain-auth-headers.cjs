const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function tokenFromFile(filePath) {
  try {
    const matches = fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('CECELIA_INTERNAL_TOKEN='));
    if (matches.length !== 1) return null;
    return matches[0].slice('CECELIA_INTERNAL_TOKEN='.length).trim() || null;
  } catch {
    return null;
  }
}

function brainAuthHeaders(env = process.env) {
  const token = env.CECELIA_INTERNAL_TOKEN?.trim() || tokenFromFile(
    env.CECELIA_INTERNAL_ENV_FILE
      || path.join(os.homedir(), '.credentials', 'cecelia-internal.env'),
  );
  return token ? { Authorization: `Bearer ${token}` } : {};
}

module.exports = { brainAuthHeaders };
