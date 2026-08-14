const DEFAULT_REPO_MAP = {
  cecelia: 'perfectuser21/cecelia',
  zenithjoy: 'perfectuser21/zenithjoy-workspace',
  'zenithjoy-skills': 'perfectuser21/zenithjoy-skills',
};

function buildRepoMap() {
  const raw = process.env.HARNESS_REPO_MAP;
  if (!raw) return DEFAULT_REPO_MAP;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return { ...DEFAULT_REPO_MAP, ...parsed };
  } catch { /* malformed override: retain safe defaults */ }
  return DEFAULT_REPO_MAP;
}

export function parseBaseRepo(baseRepo) {
  if (typeof baseRepo !== 'string') return null;
  const match = baseRepo.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  if (match) return match[1];

  const repoMap = buildRepoMap();
  if (repoMap[baseRepo]) return repoMap[baseRepo];
  const basename = baseRepo.split('/').filter(Boolean).pop() || '';
  if (basename && repoMap[basename]) return repoMap[basename];
  if (baseRepo === '/workspace' || baseRepo.endsWith('/workspace')) return repoMap.cecelia || null;
  const key = Object.keys(repoMap)
    .sort((a, b) => b.length - a.length)
    .find((candidate) => baseRepo.includes(candidate));
  return key ? repoMap[key] : null;
}

export function discoverPrFromGithub(task, short, execFn) {
  const repo = parseBaseRepo(task.payload?.base_repo ?? task.payload?.repo);
  if (!repo) return null;
  const raw = execFn(`gh pr list --repo "${repo}" --state all --limit 100 --json headRefName,title,url,state`);
  const prs = JSON.parse(raw);
  if (!Array.isArray(prs)) return null;
  const matches = prs.filter((pr) => (
    (typeof pr?.headRefName === 'string' && pr.headRefName.includes(short))
    || (typeof pr?.title === 'string' && pr.title.includes(`[${short}]`))
  ));
  return matches.find((pr) => pr.state === 'MERGED')
    || matches.find((pr) => pr.state === 'OPEN')
    || null;
}
