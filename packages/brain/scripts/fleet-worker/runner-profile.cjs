#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const FLEET_NODE_IDS = Object.freeze([
  'us-mac-m4',
  'xian-mac-m4',
  'xian-mac-m1',
]);
const IMMUTABLE_DIGEST = /^sha256:[a-f0-9]{64}$/;

function readRunnerDigest(registryPath) {
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch {
    throw new Error('runner_profile_invalid');
  }
  const profiles = registry?.profiles;
  if (
    !Array.isArray(profiles)
    || profiles.length !== FLEET_NODE_IDS.length
    || profiles.some((profile, index) => (
      profile?.machine_id !== FLEET_NODE_IDS[index]
      || !IMMUTABLE_DIGEST.test(profile?.runner_image_digest)
    ))
  ) {
    throw new Error('runner_profile_invalid');
  }
  const digests = new Set(profiles.map((profile) => profile.runner_image_digest));
  if (digests.size !== 1) throw new Error('runner_profile_invalid');
  return profiles[0].runner_image_digest;
}

function runCli() {
  const registryPath = process.argv[2];
  if (!registryPath) {
    process.stderr.write('runner_profile_invalid\n');
    process.exitCode = 1;
    return;
  }
  try {
    process.stdout.write(readRunnerDigest(registryPath));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { readRunnerDigest };

if (require.main === module) runCli();
