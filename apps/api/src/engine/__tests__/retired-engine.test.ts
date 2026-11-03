import {afterAll, beforeAll, expect, it} from 'vitest';
import express from 'express';
import {get} from 'node:http';
import type {Server} from 'node:http';
import router from '../routes.js';

let server: Server;
let url: string;
beforeAll(async () => {
  const app = express();
  app.use('/api/engine', router);
  server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('private HTTP fixture missing');
  url = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

it.each(['health', 'info'])('退休Engine接口%s明确返回410，不能制造健康或不可达故障', async endpoint => {
  const response = await new Promise<{status: number | undefined; body: any}>((resolve, reject) => {
    get(`${url}/api/engine/${endpoint}`, result => {
      let body = '';
      result.on('data', chunk => { body += chunk; });
      result.on('end', () => resolve({status: result.statusCode, body: JSON.parse(body)}));
    }).on('error', reject);
  });
  expect(response.status).toBe(410);
  expect(response.body.success).toBe(false);
  expect(response.body.status).toBe('retired');
  expect(response.body.code).toBe('ENGINE_RETIRED');
});
