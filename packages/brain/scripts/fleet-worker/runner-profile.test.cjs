'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readRunnerDigest } = require('./runner-profile.cjs');

const DIGEST = `sha256:${'a'.repeat(64)}`;

function writeRegistry(profiles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-profile-'));
  const registryPath = path.join(root, 'fleet-node-profiles.json');
  fs.writeFileSync(registryPath, JSON.stringify({ profiles }));
  return { root, registryPath };
}

describe('Fleet Runner profile SSOT', () => {
  it('reads the one shared immutable digest from all three profiles', () => {
    const { root, registryPath } = writeRegistry([
      { machine_id: 'us-mac-m4', runner_image_digest: DIGEST },
      { machine_id: 'xian-mac-m4', runner_image_digest: DIGEST },
      { machine_id: 'xian-mac-m1', runner_image_digest: DIGEST },
    ]);
    try {
      expect(readRunnerDigest(registryPath)).toBe(DIGEST);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['missing profiles', {}],
    ['missing node', { profiles: [{ machine_id: 'us-mac-m4', runner_image_digest: DIGEST }] }],
    ['floating tag', {
      profiles: [
        { machine_id: 'us-mac-m4', runner_image_digest: 'cecelia/runner:latest' },
        { machine_id: 'xian-mac-m4', runner_image_digest: 'cecelia/runner:latest' },
        { machine_id: 'xian-mac-m1', runner_image_digest: 'cecelia/runner:latest' },
      ],
    }],
    ['node drift', {
      profiles: [
        { machine_id: 'us-mac-m4', runner_image_digest: DIGEST },
        { machine_id: 'xian-mac-m4', runner_image_digest: `sha256:${'b'.repeat(64)}` },
        { machine_id: 'xian-mac-m1', runner_image_digest: DIGEST },
      ],
    }],
  ])('fails closed for %s', (_name, registry) => {
    const { root, registryPath } = writeRegistry(registry.profiles);
    if (!Object.hasOwn(registry, 'profiles')) {
      fs.writeFileSync(registryPath, JSON.stringify(registry));
    }
    try {
      expect(() => readRunnerDigest(registryPath)).toThrow(/runner_profile_invalid/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
