#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function usage(message) {
  process.stderr.write(`kernel_fs_image_contract_usage: ${message}\n`);
  process.exit(2);
}

function run(command, args, {
  allowSpawnError = false,
  inherit = true,
  timeout = 600_000,
} = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
    timeout,
  });
  if (result.error) {
    if (allowSpawnError) return result;
    process.stderr.write(
      `kernel_fs_image_contract_failed: ${result.error.code ?? 'spawn_failed'}\n`,
    );
    process.exit(1);
  }
  return result;
}

function parse(argv) {
  const build = argv.includes('--build');
  const requireDocker = argv.includes('--require-docker');
  const allowSkip = argv.includes('--allow-skip');
  const imageIndex = argv.indexOf('--image');
  const expectedLength =
    2 + (build ? 1 : 0) + (requireDocker ? 1 : 0) + (allowSkip ? 1 : 0);
  if (
    imageIndex === -1
    || imageIndex === argv.length - 1
    || argv.length !== expectedLength
    || requireDocker === allowSkip
  ) {
    usage(
      'use --image <tag> [--build] and exactly one of --require-docker/--allow-skip',
    );
  }
  const image = argv[imageIndex + 1];
  if (
    !/^[a-z0-9][a-z0-9./_-]*:[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(image)
    || argv.some((argument, index) => (
      index !== imageIndex
      && index !== imageIndex + 1
      && !['--build', '--require-docker', '--allow-skip'].includes(argument)
    ))
  ) {
    usage('image tag or argument is invalid');
  }
  return { allowSkip, build, image };
}

const options = parse(process.argv.slice(2));
const docker = run('docker', ['info'], {
  allowSpawnError: true,
  inherit: false,
  timeout: 30_000,
});
if (docker.status !== 0) {
  if (options.allowSkip) {
    process.stdout.write(
      'SKIP kernel_fs_image_contract docker_unavailable_explicit\n',
    );
    process.exit(0);
  }
  process.stderr.write(
    'kernel_fs_image_contract_failed: docker_required_but_unavailable\n',
  );
  process.exit(1);
}

if (options.build) {
  const build = run('docker', [
    'build',
    '--file',
    'packages/brain/Dockerfile',
    '--tag',
    options.image,
    '.',
  ]);
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const commands = run('docker', [
  'run',
  '--rm',
  '--entrypoint',
  '/bin/sh',
  options.image,
  '-ec',
  'command -v getfacl >/dev/null && command -v getfattr >/dev/null',
]);
if (commands.status !== 0) process.exit(commands.status ?? 1);

const behaviorProbe = String.raw`
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  assertPathAclFree,
} from 'file:///app/src/lib/kernel-equivalence-protected-filesystem.js';

const root = mkdtempSync('/tmp/kernel-fs-image-contract-');
const create = (name) => {
  const path = root + '/' + name;
  writeFileSync(path, 'protected\n', { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
};
const reject = (path, label) => {
  let rejected = false;
  try {
    assertPathAclFree(path);
  } catch (error) {
    rejected = error?.message === 'protected_path_acl_check_failed';
  }
  if (!rejected) throw new Error(label + '_was_not_rejected');
};

try {
  const normal = create('normal');
  assertPathAclFree(normal);

  const acl = create('acl');
  execFileSync('setfacl', ['-m', 'u:nobody:r', acl]);
  chmodSync(acl, 0o600);
  reject(acl, 'acl');

  const xattr = create('xattr');
  execFileSync('setfattr', [
    '-n',
    'user.kernel_equivalence',
    '-v',
    'present',
    xattr,
  ]);
  reject(xattr, 'xattr');

  const combined = create('combined');
  execFileSync('setfacl', ['-m', 'u:nobody:r', combined]);
  chmodSync(combined, 0o600);
  execFileSync('setfattr', [
    '-n',
    'user.kernel_equivalence',
    '-v',
    'present',
    combined,
  ]);
  reject(combined, 'acl_xattr');
  process.stdout.write(
    'PASS kernel_fs_image_contract normal_acl_xattr\n',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
`;

const behavior = run('docker', [
  'run',
  '--rm',
  '--entrypoint',
  'node',
  options.image,
  '--input-type=module',
  '--eval',
  behaviorProbe,
]);
if (behavior.status !== 0) process.exit(behavior.status ?? 1);
