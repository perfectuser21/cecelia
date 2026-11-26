import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  SHARED_SECRET,
  CALLBACK_TOKEN,
  MACHINE,
  jsonResponse,
  prepareInput,
  acceptedPrepareResponse,
  createTransport,
  operationInput,
  listenOnLoopback,
  closeServer,
  resolvesWithin
} from './remote-bridge-transport.fixture.js';

describe('remote Bridge start operation timeout budget', () => {
  it('gives start its own timeout budget instead of sharing the generic timeoutMs bucket', async () => {
    const fetchFn = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(new Error(`aborted ${SHARED_SECRET} ${CALLBACK_TOKEN}`));
      }, { once: true });
    }));
    // timeoutMs 只给 inspect/cancel/terminal 用；start 有单独的 startTimeoutMs，
    // 这里刻意把 timeoutMs 设得极短、startTimeoutMs 设得较长，验证 start 用的是
    // 后者而不是前者（credential FIFO 写入需要比通用轮询操作更久的窗口）。
    const transport = createTransport({ fetchFn, timeoutMs: 5, startTimeoutMs: 50 });

    const outcome = await Promise.race([
      transport.start(operationInput('start')).then(
        () => ({ status: 'resolved' }),
        (error) => ({ status: 'rejected', message: error.message }),
      ),
      new Promise((resolve) => {
        setTimeout(() => resolve({ status: 'still_pending_past_generic_timeout' }), 20);
      }),
    ]);

    expect(outcome).toEqual({ status: 'still_pending_past_generic_timeout' });
  });

  it('still times out start once startTimeoutMs elapses', async () => {
    const fetchFn = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(new Error(`aborted ${SHARED_SECRET} ${CALLBACK_TOKEN}`));
      }, { once: true });
    }));
    // timeoutMs 故意设得很大，只有真正用上 startTimeoutMs 时才会在这个有界
    // race 窗口内 reject；如果实现退回到共享 timeoutMs，会一直等不到，判定为
    // 'timed_out_waiting_for_start_timeout_budget'。
    const transport = createTransport({ fetchFn, timeoutMs: 100_000, startTimeoutMs: 5 });

    const outcome = await Promise.race([
      transport.start(operationInput('start')).then(
        () => ({ status: 'resolved' }),
        (error) => ({ status: 'rejected', message: error.message }),
      ),
      new Promise((resolve) => {
        setTimeout(() => resolve({ status: 'timed_out_waiting_for_start_timeout_budget' }), 200);
      }),
    ]);

    expect(outcome).toEqual({
      status: 'rejected',
      message: 'remote_bridge_start_timeout',
    });
  });
});

describe('remote Bridge operation deadlines', () => {
  it.each(['prepare', 'inspect', 'cancel'])(
    'keeps the %s deadline active while consuming the response body',
    async (operation) => {
      let requestSignal;
      const fetchFn = vi.fn(async (_url, options) => {
        requestSignal = options.signal;
        return {
          ok: true,
          status: operation === 'prepare' ? 202 : 200,
          json: () => new Promise((_resolve, reject) => {
            requestSignal.addEventListener('abort', () => {
              reject(new Error(`body exposed ${SHARED_SECRET} ${CALLBACK_TOKEN}`));
            }, { once: true });
          }),
        };
      });
      const sleepFn = vi.fn(async () => {});
      const transport = createTransport({ fetchFn, sleepFn, timeoutMs: 5 });

      const outcome = await Promise.race([
        transport[operation](operationInput(operation)).then(
          () => ({ status: 'resolved' }),
          (error) => ({ status: 'rejected', message: error.message }),
        ),
        new Promise((resolve) => {
          setTimeout(() => resolve({ status: 'hung' }), 50);
        }),
      ]);

      expect(outcome).toEqual({
        status: 'rejected',
        message: `remote_bridge_${operation}_timeout`,
      });
      expect(requestSignal.aborted).toBe(true);
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(sleepFn).not.toHaveBeenCalled();
      expect(outcome.message).not.toContain(SHARED_SECRET);
      expect(outcome.message).not.toContain(CALLBACK_TOKEN);
    },
  );
});

describe('remote Bridge unread response cleanup', () => {
  it.each([
    [
      'prepare',
      409,
      { status: 'rejected', message: 'remote_bridge_prepare_conflict' },
    ],
    [
      'prepare',
      503,
      { status: 'rejected', message: 'remote_bridge_prepare_http_503' },
    ],
    [
      'inspect',
      404,
      { status: 'rejected', message: 'remote_bridge_inspect_http_404' },
    ],
    [
      'inspect',
      503,
      { status: 'rejected', message: 'remote_bridge_inspect_http_503' },
    ],
    [
      'cancel',
      404,
      { status: 'resolved', value: { status: 'missing', httpStatus: 404 } },
    ],
    [
      'cancel',
      503,
      { status: 'rejected', message: 'remote_bridge_cancel_http_503' },
    ],
  ])(
    'closes an unread %s HTTP %s response without changing its outcome',
    async (operation, httpStatus, expectedOutcome) => {
      const connectionsClosed = [];
      const sleepFn = vi.fn(async () => {});
      const fetchFn = vi.fn(globalThis.fetch);
      const server = createServer((_request, response) => {
        let resolveConnectionClosed;
        connectionsClosed.push(new Promise((resolve) => {
          resolveConnectionClosed = resolve;
        }));
        response.writeHead(httpStatus, { 'Content-Type': 'application/json' });
        response.write('{"stream":"');
        const streamInterval = setInterval(() => response.write('x'), 10);
        response.once('close', () => {
          clearInterval(streamInterval);
          resolveConnectionClosed();
        });
      });

      try {
        const bridgeUrl = await listenOnLoopback(server);
        const transport = createTransport({
          bridgeUrls: { [MACHINE]: bridgeUrl },
          fetchFn,
          sleepFn,
          timeoutMs: 1000,
        });

        const outcome = await transport[operation](operationInput(operation)).then(
          (value) => ({ status: 'resolved', value }),
          (error) => ({ status: 'rejected', message: error.message }),
        );

        expect(outcome).toEqual(expectedOutcome);
        const requestCount = operation === 'prepare' && httpStatus === 503 ? 3 : 1;
        expect(fetchFn).toHaveBeenCalledTimes(requestCount);
        expect(connectionsClosed).toHaveLength(requestCount);
        expect(sleepFn.mock.calls).toEqual(requestCount === 3 ? [[5000], [5000]] : []);
        expect(await resolvesWithin(Promise.all(connectionsClosed), 100)).toBe(true);
      } finally {
        await closeServer(server);
      }
    },
  );
});

describe('remote Bridge redirect policy', () => {
  it.each(['prepare', 'inspect', 'cancel'])(
    'locks %s requests to redirect:error',
    async (operation) => {
      const fetchFn = vi.fn(async () => jsonResponse(
        operation === 'prepare' ? 202 : 200,
        operation === 'prepare'
          ? acceptedPrepareResponse()
          : operation === 'cancel'
            ? { status: 'cleaned', attempt_id: 'attempt-1' }
            : { status: 'running', attempt_id: 'attempt-1' },
      ));
      const transport = createTransport({ fetchFn });

      await transport[operation](operationInput(operation));

      expect(fetchFn.mock.calls[0][1].redirect).toBe('error');
    },
  );

  it('does not send sensitive prepare JSON to a 307 redirect target', async () => {
    let redirectedBody = '';
    let redirectedRequests = 0;
    let originalRequests = 0;
    let targetUrl;
    const sleepFn = vi.fn(async () => {});
    const fetchFn = vi.fn(globalThis.fetch);
    const targetServer = createServer(async (request, response) => {
      redirectedRequests += 1;
      request.setEncoding('utf8');
      for await (const chunk of request) {
        redirectedBody += chunk;
      }
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end('{}');
    });
    const redirectServer = createServer((request, response) => {
      originalRequests += 1;
      request.resume();
      response.writeHead(307, { Location: `${targetUrl}/capture` });
      response.end();
    });

    try {
      targetUrl = await listenOnLoopback(targetServer);
      const redirectUrl = await listenOnLoopback(redirectServer);
      const transport = createTransport({
        bridgeUrls: { [MACHINE]: redirectUrl },
        fetchFn,
        sleepFn,
        timeoutMs: 1000,
      });

      let prepareError;
      try {
        await transport.prepare(prepareInput());
      } catch (error) {
        prepareError = error;
      }

      expect(prepareError?.message).toBe('remote_bridge_prepare_request_failed');
      expect(prepareError?.message).not.toContain(SHARED_SECRET);
      expect(prepareError?.message).not.toContain(CALLBACK_TOKEN);
      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(originalRequests).toBe(3);
      expect(sleepFn.mock.calls).toEqual([[5000], [5000]]);
      expect(redirectedRequests).toBe(0);
      expect(redirectedBody).toBe('');
      expect(redirectedBody).not.toContain(CALLBACK_TOKEN);
      expect(redirectedBody).not.toContain('do the work');
    } finally {
      await Promise.all([
        closeServer(redirectServer),
        closeServer(targetServer),
      ]);
    }
  });
});

