import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  createKernelEquivalenceControllerRouter,
} from '../kernel-equivalence-controller.js';

const TOKEN = 'k'.repeat(64);
const CASE_ID = '11111111-1111-4111-8111-111111111111';

function app({
  token = TOKEN,
  getController = () => null,
} = {}) {
  const value = express();
  value.use(express.json());
  value.use(
    '/api/brain/kernel-equivalence',
    createKernelEquivalenceControllerRouter({
      getController,
      getToken: () => token,
    }),
  );
  return value;
}

describe('Kernel equivalence production controller route', () => {
  it('fails closed before resolving a controller when auth is unconfigured', async () => {
    const response = await request(app({
      token: '',
      getController: () => {
        throw new Error('must not resolve controller');
      },
    }))
      .post('/api/brain/kernel-equivalence/cases/execute')
      .send({ case_id: CASE_ID });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      error: 'production_controller_auth_unconfigured',
    });
  });

  it('rejects an invalid token before resolving a controller', async () => {
    const response = await request(app({
      getController: () => {
        throw new Error('must not resolve controller');
      },
    }))
      .post('/api/brain/kernel-equivalence/cases/execute')
      .set('Authorization', `Bearer ${'x'.repeat(64)}`)
      .send({ case_id: CASE_ID });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe(
      'production_controller_unauthorized',
    );
  });

  it('rejects caller-supplied authority axes', async () => {
    const response = await request(app({
      getController: () => {
        throw new Error('must not resolve controller');
      },
    }))
      .post('/api/brain/kernel-equivalence/cases/execute')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        case_id: CASE_ID,
        provider: 'grok',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      'production_controller_request_invalid',
    );
  });

  it('fails closed when trusted execution is not ready', async () => {
    const response = await request(app())
      .post('/api/brain/kernel-equivalence/cases/execute')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ case_id: CASE_ID });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe(
      'production_controller_unavailable',
    );
  });
});
