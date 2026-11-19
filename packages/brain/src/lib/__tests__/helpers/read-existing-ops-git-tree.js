export function readExistingOpsGitTree(git, revision) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('fixed Git fixture requires a full commit SHA');
  if (git('rev-parse', '--verify', `${revision}^{commit}`).trim() !== revision) {
    throw Error('fixed Git fixture commit identity mismatch');
  }
  const tree = git('rev-parse', `${revision}^{tree}`).trim();
  const entries = git('ls-tree', '-rz', '--full-tree', revision).split('\0').filter(Boolean).map(line => {
    const [meta, path] = line.split('\t'), [mode, type, sha] = meta.split(' ');
    return { path, mode, type, sha };
  });
  const cache = new Map();
  const read = path => {
    if (!cache.has(path)) cache.set(path, git('show', `${revision}:${path}`));
    return cache.get(path);
  };
  return { revision, tree, entries, paths: entries.map(entry => entry.path), read };
}
