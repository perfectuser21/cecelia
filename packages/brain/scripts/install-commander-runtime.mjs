#!/usr/bin/env node
import { mkdir, copyFile, writeFile, rename, lstat, symlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const destination = process.argv[2] || join(homedir(), '.local/share/cecelia/commander-runtime');
const files = ['scripts/commander-aftercare.mjs', 'src/commander-aftercare.js'];
await mkdir(dirname(destination), { recursive: true });
try {
  const existing = await lstat(destination);
  if (!existing.isSymbolicLink()) throw Error('destination-must-be-absent-or-release-symlink');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const release = `${destination}-release-${randomUUID()}`;
await mkdir(join(release, 'scripts'), { recursive: true });
await mkdir(join(release, 'src'), { recursive: true });
const hashes = {};
for (const relative of files) {
  const src = join(source, '..', relative);
  await copyFile(src, join(release, relative));
  hashes[relative] = createHash('sha256').update(await readFile(src)).digest('hex');
}
await writeFile(join(release, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
await writeFile(join(release, 'manifest.json'), JSON.stringify({ actor: 'commander-runtime-installer', at: new Date().toISOString(), hashes }, null, 2));
const temporary = `${destination}.${randomUUID()}.link`;
await symlink(release, temporary);
await rename(temporary, destination);
console.log(JSON.stringify({ destination, release, hashes }));
