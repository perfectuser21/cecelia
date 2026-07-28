import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import {
  createConnection,
  createServer,
} from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrainTrustedExecutionClient,
  createUnixSocketTrustedExecutionTransport,
} from '../kernel-equivalence-trusted-execution-client.js';
import {
  createBrainTrustedExecutionService,
  digestTrustedExecutionPlan,
} from '../kernel-equivalence-trusted-execution-service.js';
import {
  startBrainTrustedExecutionSocketServer,
} from '../kernel-equivalence-trusted-execution-socket-server.js';
import {
  bootBrainTrustedExecution,
} from '../kernel-equivalence-trusted-execution-boot.js';

const PROVIDERS = ['claude', 'codex', 'grok'];
const SCENARIOS = ['normal', 'violation', 'recovery'];
const BEHAVIORS = Array.from({ length: 11 }, (_, index) => ({
  behavior_id: `KERNEL-P${index < 7 ? 0 : 1}-${String(index + 1).padStart(2, '0')}`,
  seam_id: `kernel.test.seam_${index + 1}`,
  adapter_id: `kernel.test.adapter_${index + 1}.v1`,
}));
const CELL_ID = `${BEHAVIORS[0].behavior_id}::codex::normal`;
const GRANT_REF =
  'kernel-equivalence-grant:11111111-1111-4111-8111-111111111111';
const roots = [];

function successEnvelope(result, overrides = {}) {
  return {
    schema_version: 'kernel-equivalence-trusted-execution-response/v1',
    status: 'ok',
    cell_id: CELL_ID,
    grant_ref: GRANT_REF,
    result,
    ...overrides,
  };
}

function plan() {
  return {
    schema_version: 'kernel-equivalence-drill-plan/v1',
    behavior_count: 11,
    cells: BEHAVIORS.flatMap((behavior) => (
      PROVIDERS.flatMap((provider) => (
        SCENARIOS.map((scenario) => ({
          ...behavior,
          provider,
          scenario,
          cell_id: `${behavior.behavior_id}::${provider}::${scenario}`,
        }))
      ))
    )),
  };
}

function fixture() {
  const executeCell = vi.fn(async ({ cell, grant }) => ({
    status: 'collected',
    cell_id: cell.cell_id,
    grant_id_used: grant.grant_id,
  }));
  const resolveProtectedGrant = vi.fn(async ({ cellId, grantRef }) => ({
    cell_id: cellId,
    grant_ref: grantRef,
    grant: {
      grant_id: grantRef.slice('kernel-equivalence-grant:'.length),
      cell_id: cellId,
    },
  }));
  const pinnedPlan = plan();
  return {
    plan: pinnedPlan,
    expectedPlanDigest: digestTrustedExecutionPlan(pinnedPlan),
    runtime: {
      schema_version: 'kernel-equivalence-trusted-runtime/v1',
      adapter_count: 10,
      executeCell,
    },
    grantAuthority: {
      owner_service: 'brain.kernel_equivalence.grants',
      capability_id: 'brain.kernel_equivalence.protected_grant_reader.v1',
      resolveProtectedGrant,
    },
    executeCell,
    resolveProtectedGrant,
  };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe('Brain trusted execution service', () => {
  it('resolves only a canonical pinned cell and protected grant reference', async () => {
    const value = fixture();
    const originalPlan = value.plan;
    const service = createBrainTrustedExecutionService(value);
    originalPlan.cells[0].adapter_id = 'caller.mutated.adapter';

    const result = await service.execute({
      cell_id: CELL_ID,
      grant_ref: GRANT_REF,
    });

    expect(value.resolveProtectedGrant).toHaveBeenCalledWith({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    });
    expect(value.executeCell).toHaveBeenCalledWith(expect.objectContaining({
      cell: expect.objectContaining({
        cell_id: CELL_ID,
        adapter_id: BEHAVIORS[0].adapter_id,
      }),
      grant: {
        grant_id: GRANT_REF.slice('kernel-equivalence-grant:'.length),
        cell_id: CELL_ID,
      },
      signal: null,
      timeoutMs: expect.any(Number),
    }));
    expect(result).toMatchObject({
      status: 'collected',
      cell_id: CELL_ID,
    });
    expect(JSON.stringify(service)).toBe(JSON.stringify({
      schema_version: 'kernel-equivalence-trusted-execution-service/v1',
      cell_count: 99,
      adapter_count: 10,
      plan_digest: value.expectedPlanDigest,
    }));
  });

  it.each([
    ['caller seam', { seam_id: 'caller.seam' }],
    ['caller adapter', { adapter_id: 'caller.adapter' }],
    ['caller signer', { signer: { key_id: 'caller-key' } }],
    ['caller runtime', { runtime: {} }],
  ])('rejects %s fields before consulting grant authority', async (
    _label,
    injected,
  ) => {
    const value = fixture();
    const service = createBrainTrustedExecutionService(value);

    await expect(service.execute({
      cell_id: CELL_ID,
      grant_ref: GRANT_REF,
      ...injected,
    })).rejects.toMatchObject({
      code: 'trusted_execution_request_invalid',
    });
    expect(value.resolveProtectedGrant).not.toHaveBeenCalled();
  });

  it('rejects an authority response that does not bind the exact request', async () => {
    const value = fixture();
    value.grantAuthority.resolveProtectedGrant = vi.fn(async () => ({
      cell_id: BEHAVIORS[1].behavior_id,
      grant_ref: GRANT_REF,
      grant: {
        grant_id: GRANT_REF.slice('kernel-equivalence-grant:'.length),
        cell_id: BEHAVIORS[1].behavior_id,
      },
    }));
    const service = createBrainTrustedExecutionService(value);

    await expect(service.execute({
      cell_id: CELL_ID,
      grant_ref: GRANT_REF,
    })).rejects.toMatchObject({
      code: 'trusted_execution_grant_resolution_invalid',
    });
    expect(value.executeCell).not.toHaveBeenCalled();
  });

  it.each([
    ['plan', (value) => {
      value.plan.cells.pop();
    }, 'trusted_execution_plan_invalid'],
    ['pinned plan behavior', (value) => {
      value.plan.cells[0].behavior_id = 'CALLER-MUTATED-BEHAVIOR';
      value.plan.cells[0].cell_id =
        'CALLER-MUTATED-BEHAVIOR::claude::normal';
    }, 'trusted_execution_plan_digest_mismatch'],
    ['pinned plan seam', (value) => {
      value.plan.cells[0].seam_id = 'caller.mutated.seam';
    }, 'trusted_execution_plan_digest_mismatch'],
    ['pinned plan adapter', (value) => {
      value.plan.cells[0].adapter_id = 'caller.mutated.adapter';
    }, 'trusted_execution_plan_digest_mismatch'],
    ['runtime adapter set', (value) => {
      value.runtime.adapter_count = 9;
    }, 'trusted_execution_runtime_invalid'],
    ['grant authority owner', (value) => {
      value.grantAuthority.owner_service = 'caller.grants';
    }, 'trusted_execution_grant_authority_invalid'],
  ])('fails closed at startup for invalid %s', (_label, mutate, code) => {
    const value = fixture();
    mutate(value);

    expect(() => createBrainTrustedExecutionService(value)).toThrowError(
      expect.objectContaining({ code }),
    );
  });
});

describe('Brain trusted execution client', () => {
  it('executes end-to-end through the Brain-owned Unix listener', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-socket-'));
    roots.push(root);
    const socketPath = join(root, 'trusted-execution.sock');
    const value = fixture();
    const listener = await startBrainTrustedExecutionSocketServer({
      service: createBrainTrustedExecutionService(value),
      socketPath,
    });
    const client = createBrainTrustedExecutionClient({
      transport: createUnixSocketTrustedExecutionTransport({ socketPath }),
    });

    expect(listener.getReadiness()).toEqual({
      ready: true,
      code: null,
      socket_path: socketPath,
    });
    expect(lstatSync(socketPath).mode & 0o777).toBe(0o600);
    await expect(client.execute({
      cell_id: CELL_ID,
      grant_ref: GRANT_REF,
    })).resolves.toMatchObject({
      status: 'collected',
      cell_id: CELL_ID,
    });
    expect(value.resolveProtectedGrant).toHaveBeenCalledOnce();
    expect(value.executeCell).toHaveBeenCalledOnce();

    await listener.close();
    expect(existsSync(socketPath)).toBe(false);
  });

  it('rejects oversized and timed-out requests before dispatch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-socket-'));
    roots.push(root);
    const socketPath = join(root, 'trusted-execution.sock');
    const value = fixture();
    const listener = await startBrainTrustedExecutionSocketServer({
      service: createBrainTrustedExecutionService(value),
      socketPath,
      maximumRequestBytes: 128,
      requestDeadlineMs: 50,
    });
    const exchange = (payload = null) => new Promise((resolve) => {
      const socket = createConnection({ path: socketPath });
      let response = '';
      socket.setEncoding('utf8');
      socket.on('connect', () => {
        if (payload != null) socket.end(payload);
      });
      socket.on('data', (chunk) => {
        response += chunk;
      });
      socket.on('close', () => resolve(JSON.parse(response.trim())));
    });

    try {
      await expect(exchange(`${'x'.repeat(129)}\n`)).resolves.toMatchObject({
        status: 'blocked',
        code: 'trusted_execution_request_too_large',
      });
      await expect(exchange()).resolves.toMatchObject({
        status: 'blocked',
        code: 'trusted_execution_request_timeout',
      });
      expect(value.resolveProtectedGrant).not.toHaveBeenCalled();
    } finally {
      await listener.close();
    }
  });

  it('uses a wall-clock framing deadline that defeats slowloris writes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-socket-'));
    roots.push(root);
    const socketPath = join(root, 'trusted-execution.sock');
    const value = fixture();
    const listener = await startBrainTrustedExecutionSocketServer({
      service: createBrainTrustedExecutionService(value),
      socketPath,
      requestDeadlineMs: 50,
    });
    const response = await new Promise((resolve) => {
      const socket = createConnection({ path: socketPath });
      let output = '';
      let interval;
      socket.setEncoding('utf8');
      socket.on('connect', () => {
        interval = setInterval(() => socket.write('{'), 10);
      });
      socket.on('data', (chunk) => {
        output += chunk;
      });
      socket.on('close', () => {
        clearInterval(interval);
        resolve(JSON.parse(output.trim()));
      });
    });

    expect(response).toMatchObject({
      status: 'blocked',
      code: 'trusted_execution_request_timeout',
    });
    expect(value.resolveProtectedGrant).not.toHaveBeenCalled();
    await listener.close();
  });

  it('aborts at the total deadline and confirms cancellation before response', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-socket-'));
    roots.push(root);
    const socketPath = join(root, 'trusted-execution.sock');
    const value = fixture();
    let lateEffect = false;
    let cancellationConfirmedAt = 0;
    value.runtime.executeCell = vi.fn(({
      signal,
      timeoutMs,
    }) => new Promise((resolve) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(timeoutMs).toBeGreaterThan(0);
      expect(timeoutMs).toBeLessThanOrEqual(50);
      const effect = setTimeout(() => {
        lateEffect = true;
      }, 100);
      signal.addEventListener('abort', () => {
        clearTimeout(effect);
        setTimeout(() => {
          cancellationConfirmedAt = Date.now();
          resolve({
            status: 'blocked',
            code: 'trusted_execution_deadline_exceeded',
          });
        }, 15);
      }, { once: true });
    }));
    const listener = await startBrainTrustedExecutionSocketServer({
      service: createBrainTrustedExecutionService(value),
      socketPath,
      executionDeadlineMs: 50,
    });
    const client = createBrainTrustedExecutionClient({
      transport: createUnixSocketTrustedExecutionTransport({
        socketPath,
        timeoutMs: 250,
      }),
    });

    try {
      const result = await client.execute({
        cell_id: CELL_ID,
        grant_ref: GRANT_REF,
      });
      const responseAt = Date.now();

      expect(result).toEqual({
        status: 'blocked',
        code: 'trusted_execution_deadline_exceeded',
      });
      expect(cancellationConfirmedAt).toBeGreaterThan(0);
      expect(responseAt).toBeGreaterThanOrEqual(cancellationConfirmedAt);
      await new Promise((resolve) => setTimeout(resolve, 70));
      expect(lateEffect).toBe(false);
    } finally {
      await listener.close();
    }
  });

  it('aborts runtime execution when the caller disconnects', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-socket-'));
    roots.push(root);
    const socketPath = join(root, 'trusted-execution.sock');
    const value = fixture();
    let lateEffect = false;
    let resolveStarted;
    let resolveCancelled;
    const started = new Promise((resolve) => {
      resolveStarted = resolve;
    });
    const cancelled = new Promise((resolve) => {
      resolveCancelled = resolve;
    });
    value.runtime.executeCell = vi.fn(({ signal }) => new Promise((resolve) => {
      const effect = setTimeout(() => {
        lateEffect = true;
      }, 100);
      resolveStarted();
      signal.addEventListener('abort', () => {
        clearTimeout(effect);
        resolveCancelled();
        resolve({
          status: 'blocked',
          code: 'trusted_execution_client_disconnected',
        });
      }, { once: true });
    }));
    const listener = await startBrainTrustedExecutionSocketServer({
      service: createBrainTrustedExecutionService(value),
      socketPath,
      executionDeadlineMs: 250,
    });
    const socket = createConnection({ path: socketPath });
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write(`${JSON.stringify({
      cell_id: CELL_ID,
      grant_ref: GRANT_REF,
    })}\n`);
    await started;
    socket.destroy();

    await cancelled;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(lateEffect).toBe(false);
    await listener.close();
  });

  it('rejects trailing, blank, or late request bytes before dispatch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-socket-'));
    roots.push(root);
    const socketPath = join(root, 'trusted-execution.sock');
    const value = fixture();
    const listener = await startBrainTrustedExecutionSocketServer({
      service: createBrainTrustedExecutionService(value),
      socketPath,
    });
    const request = JSON.stringify({
      cell_id: CELL_ID,
      grant_ref: GRANT_REF,
    });
    const invalidFrames = [
      `${request}\n `,
      `${request}\n\n`,
      `${request}\n${JSON.stringify({ extra: true })}\n`,
    ];

    try {
      for (const frame of invalidFrames) {
        const response = await new Promise((resolve) => {
          const socket = createConnection({ path: socketPath });
          let output = '';
          socket.setEncoding('utf8');
          socket.on('connect', () => socket.end(frame));
          socket.on('data', (chunk) => {
            output += chunk;
          });
          socket.on('close', () => resolve(JSON.parse(output.trim())));
        });
        expect(response).toMatchObject({
          status: 'blocked',
          code: 'trusted_execution_request_invalid',
        });
      }
      expect(value.resolveProtectedGrant).not.toHaveBeenCalled();
    } finally {
      await listener.close();
    }
  });

  it('bounds responses emitted by the Brain-owned listener', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-socket-'));
    roots.push(root);
    const socketPath = join(root, 'trusted-execution.sock');
    const value = fixture();
    value.runtime.executeCell = vi.fn(async () => ({
      status: 'collected',
      payload: 'x'.repeat(2_000),
    }));
    const listener = await startBrainTrustedExecutionSocketServer({
      service: createBrainTrustedExecutionService(value),
      socketPath,
      maximumResponseBytes: 512,
    });
    const client = createBrainTrustedExecutionClient({
      transport: createUnixSocketTrustedExecutionTransport({ socketPath }),
    });

    try {
      await expect(client.execute({
        cell_id: CELL_ID,
        grant_ref: GRANT_REF,
      })).rejects.toMatchObject({
        code: 'trusted_execution_response_too_large',
      });
    } finally {
      await listener.close();
    }
  });

  it('refuses every pre-existing socket target including a symlink', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-socket-'));
    roots.push(root);
    const socketPath = join(root, 'trusted-execution.sock');
    symlinkSync(join(root, 'attacker-target'), socketPath);
    const value = fixture();

    await expect(startBrainTrustedExecutionSocketServer({
      service: createBrainTrustedExecutionService(value),
      socketPath,
    })).rejects.toMatchObject({
      code: 'trusted_execution_socket_path_occupied',
    });
    expect(lstatSync(socketPath).isSymbolicLink()).toBe(true);
  });

  it('never unlinks a replacement that is not its exact socket inode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-socket-'));
    roots.push(root);
    const socketPath = join(root, 'trusted-execution.sock');
    const listener = await startBrainTrustedExecutionSocketServer({
      service: createBrainTrustedExecutionService(fixture()),
      socketPath,
    });
    unlinkSync(socketPath);
    symlinkSync(join(root, 'replacement-target'), socketPath);

    await listener.close();

    expect(lstatSync(socketPath).isSymbolicLink()).toBe(true);
  });

  it('boots fail-closed without a configured trusted assembly', async () => {
    const boot = await bootBrainTrustedExecution();

    expect(boot.getReadiness()).toEqual({
      ready: false,
      code: 'trusted_execution_assembly_unconfigured',
      socket_path: null,
    });
    await expect(boot.close()).resolves.toBeUndefined();
  });

  it('boots a configured service and reports listener readiness', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-socket-'));
    roots.push(root);
    const socketPath = join(root, 'trusted-execution.sock');
    const boot = await bootBrainTrustedExecution({
      createService: async () => (
        createBrainTrustedExecutionService(fixture())
      ),
      socketPath,
    });

    expect(boot.getReadiness()).toEqual({
      ready: true,
      code: null,
      socket_path: socketPath,
    });
    await boot.close();
    expect(existsSync(socketPath)).toBe(false);
  });

  it('sends only cell_id and grant_ref through a 0600 Unix socket', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-socket-'));
    roots.push(root);
    const socketPath = join(root, 'trusted-execution.sock');
    let received;
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      let input = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        input += chunk;
      });
      socket.on('data', () => {
        if (received || !input.endsWith('\n')) return;
        received = JSON.parse(input.slice(0, -1));
        socket.end(`${JSON.stringify({
          ...successEnvelope({
            status: 'collected',
            cell_id: received.cell_id,
          }),
          cell_id: received.cell_id,
          grant_ref: received.grant_ref,
        })}\n`);
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    chmodSync(socketPath, 0o600);

    try {
      const client = createBrainTrustedExecutionClient({
        transport: createUnixSocketTrustedExecutionTransport({
          socketPath,
        }),
      });
      const result = await client.execute({
        cell_id: CELL_ID,
        grant_ref: GRANT_REF,
      });

      expect(received).toEqual({
        cell_id: CELL_ID,
        grant_ref: GRANT_REF,
      });
      expect(result).toEqual({
        status: 'collected',
        cell_id: CELL_ID,
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('refuses a Unix socket that is not mode 0600', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-socket-'));
    roots.push(root);
    const socketPath = join(root, 'trusted-execution.sock');
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    chmodSync(socketPath, 0o666);

    try {
      const transport = createUnixSocketTrustedExecutionTransport({
        socketPath,
      });
      await expect(transport({
        cell_id: CELL_ID,
        grant_ref: GRANT_REF,
      })).rejects.toMatchObject({
        code: 'trusted_execution_socket_unsafe',
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('supports an injected transport without exposing assembly inputs', async () => {
    const transport = vi.fn(async () => successEnvelope({
      status: 'collected',
      cell_id: CELL_ID,
    }));
    const client = createBrainTrustedExecutionClient({ transport });

    await client.execute({
      cell_id: CELL_ID,
      grant_ref: GRANT_REF,
    });

    expect(transport).toHaveBeenCalledWith({
      cell_id: CELL_ID,
      grant_ref: GRANT_REF,
    });
    await expect(client.execute({
      cell_id: CELL_ID,
      grant_ref: GRANT_REF,
      adapter: {},
    })).rejects.toMatchObject({
      code: 'trusted_execution_request_invalid',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing cell binding', () => {
      const value = successEnvelope({ status: 'collected' });
      delete value.cell_id;
      return value;
    }],
    ['wrong cell binding', () => successEnvelope(
      { status: 'collected' },
      { cell_id: `${BEHAVIORS[1].behavior_id}::codex::normal` },
    )],
    ['missing grant binding', () => {
      const value = successEnvelope({ status: 'collected' });
      delete value.grant_ref;
      return value;
    }],
    ['wrong grant binding', () => successEnvelope(
      { status: 'collected' },
      {
        grant_ref:
          'kernel-equivalence-grant:22222222-2222-4222-8222-222222222222',
      },
    )],
    ['unknown envelope field', () => successEnvelope(
      { status: 'collected' },
      { caller_field: true },
    )],
  ])('rejects a response with %s', async (_label, response) => {
    const client = createBrainTrustedExecutionClient({
      transport: vi.fn(async () => response()),
    });

    await expect(client.execute({
      cell_id: CELL_ID,
      grant_ref: GRANT_REF,
    })).rejects.toMatchObject({
      code: 'trusted_execution_response_invalid',
    });
  });

  it.each([
    ['trailing whitespace', ' '],
    ['blank line', '\n'],
    ['second JSON line', `${JSON.stringify({ extra: true })}\n`],
  ])('rejects a socket response with %s', async (_label, trailing) => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-socket-'));
    roots.push(root);
    const socketPath = join(root, 'trusted-execution.sock');
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      socket.on('data', () => {
        socket.end(
          `${JSON.stringify(successEnvelope({
            status: 'collected',
          }))}\n${trailing}`,
        );
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    chmodSync(socketPath, 0o600);

    try {
      const client = createBrainTrustedExecutionClient({
        transport: createUnixSocketTrustedExecutionTransport({
          socketPath,
        }),
      });
      await expect(client.execute({
        cell_id: CELL_ID,
        grant_ref: GRANT_REF,
      })).rejects.toMatchObject({
        code: 'trusted_execution_response_invalid',
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
