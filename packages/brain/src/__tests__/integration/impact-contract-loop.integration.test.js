import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  getActiveImpactContract,
  persistImpactContract,
} from '../../impact-contract/contract-store.js';
import {
  addHardDependency,
  assignRepairTask,
  openGapForDrift,
  transitionGapStatus,
} from '../../impact-contract/gap-store.js';

import { seedOwnedActiveV2RunInClient } from './helpers/controller-authority-fixture.js';

let pool;

beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../../db.js')).default;
});

afterAll(async () => {
  await pool.end();
});
