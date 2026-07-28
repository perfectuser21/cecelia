import { describe, expect, it } from 'vitest';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  isPublicCodexReviewAddress,
  parseCodexReviewConnectRequest,
  startCodexReviewEgressBroker,
} from '../codex-review-egress-broker.js';

describe('Codex review egress broker', () => {
  it.each([
    'chatgpt.com',
    'auth.openai.com',
  ])('allows only exact OpenAI HTTPS CONNECT host %s', (hostname) => {
    expect(parseCodexReviewConnectRequest(
      `CONNECT ${hostname}:443 HTTP/1.1\r\nHost: ${hostname}:443\r\n\r\n`,
    )).toEqual({ hostname, port: 443 });
  });

  it.each([
    'CONNECT host.docker.internal:5221 HTTP/1.1\r\nHost: host.docker.internal:5221\r\n\r\n',
    'CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n',
    'CONNECT chatgpt.com:80 HTTP/1.1\r\nHost: chatgpt.com:80\r\n\r\n',
    'CONNECT evil.chatgpt.com:443 HTTP/1.1\r\nHost: evil.chatgpt.com:443\r\n\r\n',
    'CONNECT api.openai.com:443 HTTP/1.1\r\nHost: api.openai.com:443\r\n\r\n',
    'CONNECT chatgpt.com.:443 HTTP/1.1\r\nHost: chatgpt.com.:443\r\n\r\n',
    'GET https://chatgpt.com/ HTTP/1.1\r\nHost: chatgpt.com\r\n\r\n',
    'CONNECT chatgpt.com:443 HTTP/1.1\r\nHost: auth.openai.com:443\r\n\r\n',
    'CONNECT chatgpt.com:443 HTTP/1.0\r\nHost: chatgpt.com:443\r\n\r\n',
  ])('fails closed for non-allowlisted CONNECT request', (request) => {
    expect(parseCodexReviewConnectRequest(request)).toBeNull();
  });

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.1.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:7f00:1',
    '::ffff:a00:1',
    '::ffff:ac10:1',
    '::ffff:c0a8:1',
    '64:ff9b::808:808',
    '2002:0808:0808::',
    '2001:db8::1',
  ])('rejects non-global DNS address %s', (address) => {
    expect(isPublicCodexReviewAddress(address)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
  ])('accepts global-unicast DNS address %s', (address) => {
    expect(isPublicCodexReviewAddress(address)).toBe(true);
  });

  it('rejects a valid host whose DNS answer is private before opening upstream', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'review-broker-'));
    const socketPath = path.join(directory, 'proxy.sock');
    let upstreamCalls = 0;
    const broker = await startCodexReviewEgressBroker({
      socketPath,
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      connect: () => {
        upstreamCalls++;
        throw new Error('must not connect');
      },
    });
    try {
      const response = await new Promise((resolve, reject) => {
        const client = net.createConnection({ path: socketPath });
        client.once('error', reject);
        client.once('connect', () => {
          client.write(
            'CONNECT chatgpt.com:443 HTTP/1.1\r\n'
            + 'Host: chatgpt.com:443\r\n\r\n',
          );
        });
        client.once('data', (data) => resolve(data.toString('latin1')));
      });
      expect(response).toContain('403 Forbidden');
      expect(upstreamCalls).toBe(0);
    } finally {
      await broker.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not create an upstream after the client closes during DNS lookup', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'review-broker-'));
    const socketPath = path.join(directory, 'proxy.sock');
    let upstreamCalls = 0;
    const broker = await startCodexReviewEgressBroker({
      socketPath,
      lookup: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return [{ address: '8.8.8.8', family: 4 }];
      },
      connect: () => {
        upstreamCalls++;
        throw new Error('late upstream');
      },
    });
    try {
      await new Promise((resolve, reject) => {
        const client = net.createConnection({ path: socketPath });
        client.once('error', reject);
        client.once('connect', () => {
          client.end(
            'CONNECT chatgpt.com:443 HTTP/1.1\r\n'
            + 'Host: chatgpt.com:443\r\n\r\n',
            resolve,
          );
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(upstreamCalls).toBe(0);
    } finally {
      await broker.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
