import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
} from 'node:fs';
import { join, relative } from 'node:path';

function visit(hash, root, path, excludedPaths) {
  const stat = lstatSync(path);
  const name = relative(root, path) || '.';
  if (excludedPaths.has(name)) return;
  if (stat.isDirectory()) {
    hash.update(`directory\0${name}\0`);
    for (const entry of readdirSync(path).sort()) {
      visit(hash, root, join(path, entry), excludedPaths);
    }
    return;
  }
  if (stat.isSymbolicLink()) {
    hash.update(`symlink\0${name}\0${readlinkSync(path)}\0`);
    return;
  }
  if (!stat.isFile()) throw new Error('release_tree_digest_unsupported_entry');
  hash.update(`file\0${name}\0${stat.mode & 0o111 ? 'executable' : 'regular'}\0`);
  hash.update(readFileSync(path));
  hash.update('\0');
}

export function digestTree(root, { exclude = [] } = {}) {
  const hash = createHash('sha256');
  visit(hash, root, root, new Set(exclude));
  return `sha256:${hash.digest('hex')}`;
}
