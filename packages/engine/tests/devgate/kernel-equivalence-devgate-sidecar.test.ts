import { execFileSync, execSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDevGateEquivalenceSeam,
} from '../../scripts/devgate/kernel-equivalence-devgate-sidecar.mjs';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const fixtures: string[] = [];

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createWorkspace(scenario: 'normal' | 'violation' | 'recovery') {
  const workspace = mkdtempSync(join(tmpdir(), 'equivalence-devgate-'));
  fixtures.push(workspace);
  execSync('git init -q', { cwd: workspace });
  git(workspace, ['config', 'user.email', 'ci@test']);
  git(workspace, ['config', 'user.name', 'CI']);
  writeFileSync(join(workspace, 'README.md'), 'base\n');
  git(workspace, ['add', '.']);
  git(workspace, ['commit', '-q', '-m', 'chore: base']);
  git(workspace, ['branch', 'base']);

  mkdirSync(join(workspace, 'sprints', 'drill', 'tests'), {
    recursive: true,
  });
  writeFileSync(
    join(workspace, 'sprints', 'drill', 'tests', 'behavior.test.ts'),
    'it("fails before implementation", () => {});\n',
  );
  const dodPath = join(
    workspace,
    'sprints',
    'drill',
    'contract-dod-ws0.md',
  );
  writeFileSync(
    dodPath,
    [
      '# DoD',
      '',
      scenario === 'violation'
        ? '- [ ] [BEHAVIOR] exact contract'
        : '- [x] [BEHAVIOR] exact contract',
      '  Test: tests/behavior.test.ts',
      '',
    ].join('\n'),
  );
  if (scenario === 'violation') {
    mkdirSync(join(workspace, 'packages', 'illegal'), { recursive: true });
    writeFileSync(
      join(workspace, 'packages', 'illegal', 'index.js'),
      'export const illegal = true;\n',
    );
  }
  git(workspace, ['add', '.']);
  git(workspace, [
    'commit',
    '-q',
    '-m',
    'test(harness): equivalence drill (Red)',
  ]);

  if (scenario !== 'violation') {
    mkdirSync(join(workspace, 'packages', 'example'), { recursive: true });
    writeFileSync(
      join(workspace, 'packages', 'example', 'index.js'),
      'export const ready = true;\n',
    );
    git(workspace, ['add', '.']);
    git(workspace, [
      'commit',
      '-q',
      '-m',
      'feat(example): implementation (Green)',
    ]);
  }

  return { workspace, dodPath };
}

function fixture(scenario: 'normal' | 'violation' | 'recovery') {
  const { workspace, dodPath } = createWorkspace(scenario);
  const cell = {
    cell_id: `KERNEL-P1-09-DEVGATE-TDD-DOD::codex::${scenario}`,
    behavior_id: 'KERNEL-P1-09-DEVGATE-TDD-DOD',
    provider: 'codex',
    scenario,
    seam_id: 'kernel.quality.devgate',
    adapter_id: 'kernel.drill.devgate_tdd_dod.v1',
  };
  const grant = {
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    resource_id: `eq-${ATTEMPT_ID}`,
    resource_ref:
      `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/workspace/case`,
  };
  const snapshots = [
    { head: git(workspace, ['rev-parse', 'HEAD']) },
    { head: git(workspace, ['rev-parse', 'HEAD']) },
  ];
  const resource = {
    resource_id: grant.resource_id,
    resource_ref: grant.resource_ref,
    workspace_path: '/forged',
    base_ref: 'forged',
    head_ref: 'forged',
    dod_path: '/forged/contract-dod-ws0.md',
    snapshot: vi.fn(async () => snapshots.shift()),
  };
  const devgateAuthority = {
    owner_service: 'kernel.quality.devgate',
    loadTarget: vi.fn(async () => ({
      workspace_path: workspace,
      base_ref: 'base',
      head_ref: 'HEAD',
      dod_path: dodPath,
    })),
  };
  const effectSigner = {
    signEffectResult: vi.fn(async (effect) => ({
      schema_version: 'kernel-equivalence-effect-receipt/v1',
      ...effect,
      signature: 'test-signature',
    })),
  };
  return {
    workspace,
    cell,
    grant,
    resource,
    effectSigner,
    devgateAuthority,
    seam: createDevGateEquivalenceSeam({
      effectSigner,
      devgateAuthority,
    }),
  };
}

afterEach(() => {
  while (fixtures.length) {
    rmSync(fixtures.pop()!, { recursive: true, force: true });
  }
});

describe('DevGate equivalence guarded sidecar', () => {
  it.each([
    ['normal', 'confirmed', 'devgate_admission_confirmed'],
    ['violation', 'denied', 'devgate_invalid_evidence_denied'],
    ['recovery', 'recovered', 'corrected_devgate_admission_confirmed'],
  ] as const)('runs the actual TDD/DoD gates for %s', async (
    scenario,
    observedOutcome,
    effectCode,
  ) => {
    const value = fixture(scenario);
    const predecessor = scenario === 'recovery'
      ? {
          grant: {
            grant_id: '44444444-4444-4444-8444-444444444444',
          },
          receipt: {
            receipt_id: '33333333-3333-4333-8333-333333333333',
          },
        }
      : null;

    const receipt = await value.seam.invoke({
      cell: value.cell,
      grant: value.grant,
      resource: value.resource,
      predecessor,
      signal: new AbortController().signal,
    });

    expect(receipt).toMatchObject({
      observed_outcome: observedOutcome,
      effect_code: effectCode,
      signature: 'test-signature',
    });
    expect(value.effectSigner.signEffectResult).toHaveBeenCalledWith(
      expect.objectContaining({
        service_id: 'kernel.quality.devgate',
        observed_outcome: observedOutcome,
        effect_code: effectCode,
        predecessor,
      }),
    );
    expect(value.devgateAuthority.loadTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: {
          resource_id: value.resource.resource_id,
          resource_ref: value.resource.resource_ref,
        },
      }),
    );
    expect(value.resource.snapshot).not.toHaveBeenCalled();
  });

  it('keeps signer material out of the child environment', async () => {
    const value = fixture('normal');
    let childEnvironment: NodeJS.ProcessEnv | null = null;
    const spawnGuarded = vi.fn(async (command) => {
      childEnvironment = command.env;
      return { exit_code: 0, stdout: 'ok', stderr: '' };
    });
    value.seam = createDevGateEquivalenceSeam({
      effectSigner: value.effectSigner,
      devgateAuthority: value.devgateAuthority,
      spawnGuarded,
    });

    await value.seam.invoke({
      cell: value.cell,
      grant: value.grant,
      resource: value.resource,
      signal: new AbortController().signal,
    });

    expect(childEnvironment).not.toBeNull();
    expect(Object.keys(childEnvironment ?? {}).join(' ')).not.toMatch(
      /sign|private|secret|key/i,
    );
    expect(JSON.stringify(childEnvironment)).not.toContain('test-signature');
  });

  it('aborts the guarded child and never signs a late effect', async () => {
    const value = fixture('normal');
    const controller = new AbortController();
    const spawnGuarded = vi.fn(({ signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => resolve({ exit_code: 0, stdout: 'late', stderr: '' }),
        50,
      );
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }));
      }, { once: true });
    }));
    value.seam = createDevGateEquivalenceSeam({
      effectSigner: value.effectSigner,
      devgateAuthority: value.devgateAuthority,
      spawnGuarded,
    });

    const operation = value.seam.invoke({
      cell: value.cell,
      grant: value.grant,
      resource: value.resource,
      signal: controller.signal,
    });
    controller.abort();

    await expect(operation).rejects.toMatchObject({ code: 'ABORT_ERR' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(value.effectSigner.signEffectResult).not.toHaveBeenCalled();
    await expect(value.seam.cancel({
      signal: controller.signal,
    })).resolves.toEqual({ confirmed: true });
  });

  it('uses only the fixed checked-in scripts and rejects an escaped DoD path', async () => {
    const value = fixture('normal');
    value.devgateAuthority.loadTarget.mockResolvedValue({
      workspace_path: value.workspace,
      base_ref: 'base',
      head_ref: 'HEAD',
      dod_path: join(value.workspace, '..', 'outside.md'),
    });

    await expect(value.seam.invoke({
      cell: value.cell,
      grant: value.grant,
      resource: value.resource,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'devgate_equivalence_resource_invalid',
    });
    expect(value.effectSigner.signEffectResult).not.toHaveBeenCalled();
  });

  it('requires a server-owned signer object and DevGate authority port', () => {
    const value = fixture('normal');
    expect(() => createDevGateEquivalenceSeam({
      devgateAuthority: value.devgateAuthority,
    })).toThrowError(expect.objectContaining({
      code: 'seam_effect_signer_unavailable',
    }));
    expect(() => createDevGateEquivalenceSeam({
      effectSigner: value.effectSigner,
    })).toThrowError(expect.objectContaining({
      code: 'devgate_authority_port_unavailable',
    }));
  });

  it('does not embed or read a signing key', () => {
    const source = readFileSync(
      new URL(
        '../../scripts/devgate/kernel-equivalence-devgate-sidecar.mjs',
        import.meta.url,
      ),
      'utf8',
    );
    expect(source).not.toMatch(/PRIVATE KEY|privateKey|SIGNER_KEY|signBytes/);
  });
});
