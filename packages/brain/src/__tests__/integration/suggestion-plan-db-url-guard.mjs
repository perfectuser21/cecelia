import { pathToFileURL } from 'node:url';

/** A disposable local database only; libpq query parameters cannot override its host. */
export function validateTestDatabaseUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.includes('?') || raw.includes('#')) {
    throw new Error('TEST_DATABASE_URL must be explicit and contain no query or fragment');
  }
  let target;
  try { target = new URL(raw); } catch { throw new Error('invalid TEST_DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
      || !/_(scratch|test)$/.test(target.pathname.slice(1))) {
    throw new Error('local scratch/test PostgreSQL database required');
  }
  return raw;
}

// Executable security checks; importing this module does not register tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { test } = await import('node:test');
  const assert = await import('node:assert/strict');
  test('rejects libpq host and options overrides before any connection', () => {
    for (const suffix of ['?host=remote', '?options=-c%20search_path%3Dpublic', '#fragment', '?']) {
      assert.throws(() => validateTestDatabaseUrl(`postgresql://ci@localhost/cecelia_scratch${suffix}`));
    }
  });
  test('requires PostgreSQL and a local scratch/test database', () => {
    for (const input of ['', 'https://localhost/cecelia_scratch', 'postgresql://remote/cecelia_scratch', 'postgresql://localhost/cecelia']) {
      assert.throws(() => validateTestDatabaseUrl(input));
    }
    assert.equal(validateTestDatabaseUrl('postgresql://ci@127.0.0.1/cecelia_scratch'), 'postgresql://ci@127.0.0.1/cecelia_scratch');
  });
}
