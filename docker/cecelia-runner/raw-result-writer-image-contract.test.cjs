const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const RUNNER_DIR = __dirname;
const DOCKERFILE = readFileSync(join(RUNNER_DIR, 'Dockerfile'), 'utf8');

test('runner image installs the central raw result writer at the fixed Skill seam', () => {
  assert.match(
    DOCKERFILE,
    /^COPY raw-result-writer\.cjs \/usr\/local\/bin\/raw-result-writer\.cjs$/m,
  );
  assert.match(
    DOCKERFILE,
    /chmod (?:0?755|\+x) \/usr\/local\/bin\/raw-result-writer\.cjs/,
  );
});
