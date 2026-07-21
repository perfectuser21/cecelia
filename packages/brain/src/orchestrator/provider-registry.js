const REQUIRED_METHODS = ['start', 'resume', 'inspect', 'cancel', 'normalizeResult'];

function assertAdapter(adapter) {
  if (!adapter || typeof adapter.name !== 'string' || !adapter.name) {
    throw new Error('provider adapter requires a non-empty name');
  }
  if (!Array.isArray(adapter.capabilities)) {
    throw new Error(`provider adapter ${adapter.name} requires capabilities[]`);
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') {
      throw new Error(`provider adapter ${adapter.name} requires ${method}()`);
    }
  }
}

function missingCapabilities(adapter, requires) {
  const available = new Set(adapter.capabilities);
  return requires.filter((capability) => !available.has(capability));
}

/** Build an ordered, deterministic provider registry. `auto` picks a provider, never a model. */
export function createProviderRegistry(adapters) {
  const providers = new Map();
  for (const adapter of adapters) {
    assertAdapter(adapter);
    if (providers.has(adapter.name)) {
      throw new Error(`duplicate provider adapter: ${adapter.name}`);
    }
    providers.set(adapter.name, adapter);
  }

  function get(name) {
    const adapter = providers.get(name);
    if (!adapter) throw new Error(`unknown provider: ${name}`);
    return adapter;
  }

  function resolve({ provider = 'auto', requires = [] } = {}) {
    if (provider !== 'auto') {
      const adapter = get(provider);
      const missing = missingCapabilities(adapter, requires);
      if (missing.length) {
        throw new Error(`provider ${provider} missing capabilities: ${missing.join(', ')}`);
      }
      return adapter;
    }

    for (const adapter of providers.values()) {
      if (missingCapabilities(adapter, requires).length === 0) return adapter;
    }
    throw new Error(`no provider satisfies capabilities: ${requires.join(', ') || '(none)'}`);
  }

  return Object.freeze({
    get,
    resolve,
    names: () => [...providers.keys()],
  });
}
