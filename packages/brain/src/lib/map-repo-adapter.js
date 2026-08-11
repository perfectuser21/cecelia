export class MapRepoAdapterError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MapRepoAdapterError';
    this.code = code;
    this.details = details;
  }
}

function requireScopeKey(scopeKey) {
  if (typeof scopeKey !== 'string' || scopeKey.trim().length === 0) {
    throw new MapRepoAdapterError(
      'MAP_REPO_ADAPTER_SCOPE_INVALID',
      'Map repo adapter requires a non-empty scope key',
    );
  }
  return scopeKey.trim();
}

export async function loadMapRepoAdapters(client, scopeKey) {
  if (!client?.query) {
    throw new MapRepoAdapterError(
      'MAP_REPO_ADAPTER_CLIENT_INVALID',
      'Map repo adapter requires a PostgreSQL client',
    );
  }
  const normalizedScopeKey = requireScopeKey(scopeKey);
  const { rows } = await client.query(
    `SELECT scope_key, repo, adapter_key, adapter_config
       FROM map_scope_repositories
      WHERE scope_key = $1
      ORDER BY repo ASC`,
    [normalizedScopeKey],
  );
  if (!rows?.length) {
    throw new MapRepoAdapterError(
      'MAP_REPO_ADAPTER_NOT_CONFIGURED',
      `No repositories are configured for map scope ${normalizedScopeKey}`,
      { scope_key: normalizedScopeKey },
    );
  }
  return rows
    .map(({ scope_key, repo, adapter_key, adapter_config }) => ({
      scope_key,
      repo,
      adapter_key,
      adapter_config: adapter_config ?? {},
    }))
    .sort((left, right) => left.repo.localeCompare(right.repo));
}
