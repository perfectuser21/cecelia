import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { releaseEvidenceDatabase } from '../../../__tests__/fixtures/release-evidence-db.js';
import { createReleasesRouter } from '../../releases.js';
let f,app;
beforeEach(async()=>{f=await releaseEvidenceDatabase();app=express();app.use(express.json());app.use('/releases',createReleasesRouter({pool:f.db,trustedCollectors:['fixture-collector']}));});
afterEach(async()=>{vi.unstubAllEnvs();await f?.close();});
it('发布及ACK丢失回读返回固定对象，观测必须属于指定release',async()=>{
  const release=(await request(app).post('/releases').send(f.releaseInput)).body.release;
  expect((await request(app).get(`/releases/${release.id}`)).body.release).toEqual(release);
  const observation=(await request(app).post(`/releases/${release.id}/observations`).send(f.observationInput)).body.observation;
  expect((await request(app).get(`/releases/${release.id}/observations/${observation.id}`)).body.observation).toEqual(observation);
  const other=(await request(app).post('/releases').send({...f.releaseInput,release_key:'other'})).body.release;
  expect((await request(app).get(`/releases/${other.id}/observations/${observation.id}`)).status).toBe(404);
});
it('内部token配置后loopback也须鉴权；collector默认未配置不能写实测',async()=>{
  vi.stubEnv('CECELIA_INTERNAL_TOKEN','fixture-internal-token');
  expect((await request(app).post('/releases').send(f.releaseInput)).status).toBe(401);
  const release=(await request(app).post('/releases').set('X-Internal-Token','fixture-internal-token').send(f.releaseInput)).body.release;
  vi.stubEnv('CECELIA_RELEASE_COLLECTORS','');
  const unconfigured=express();unconfigured.use(express.json());unconfigured.use('/releases',createReleasesRouter({pool:f.db}));
  const result=await request(unconfigured).post(`/releases/${release.id}/observations`).set('X-Internal-Token','fixture-internal-token').send(f.observationInput);
  expect(result.status).toBe(503);expect(result.body.error.code).toBe('RELEASE_COLLECTOR_UNCONFIGURED');
  expect((await f.db.query('SELECT count(*)::int n FROM release_observations')).rows[0].n).toBe(0);
});
