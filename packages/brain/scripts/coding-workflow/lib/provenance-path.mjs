import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function provenanceRoot(home = os.homedir()) {
  return path.resolve(home, '.cecelia', 'coding-workflow-provenance');
}

// Resolve existing ancestors too: a not-yet-created destination can cross a symlink.
// Reject traversal before normalization, which would otherwise erase alias/../ semantics.
export function canonicalPath(file) {
  if (typeof file !== 'string' || !file || file.includes('\0') || file.split(path.sep).includes('..')) {
    throw new Error('provenance_path_invalid');
  }
  let cursor = path.resolve(file);
  const tail = [];
  for (;;) {
    try {
      fs.lstatSync(cursor);
      return path.join(fs.realpathSync(cursor), ...tail);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A dangling symlink is not an absent ancestor with a trustworthy destination.
      try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('provenance_path_dangling_symlink'); } catch (inner) {
        if (inner.code !== 'ENOENT') throw inner;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      tail.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function assertProvenanceSeparation(root, paths) {
  const realRoot = canonicalPath(root);
  for (const file of paths) {
    const real = canonicalPath(file);
    for (const [a, b] of [[path.resolve(root), path.resolve(file)], [realRoot, real]]) {
      if (contains(a, b) || contains(b, a)) throw new Error('provenance_path_overlap');
    }
  }
  return realRoot;
}
