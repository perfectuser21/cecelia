import pg from 'pg';
import {it,expect,vi} from 'vitest';
import {DB_DEFAULTS} from '../../db-config.js';
import {createPhoneClaimFixture} from './phone-claim-schema.js';

it('CI other_test must reject before any native connection/query/schema or pool exposure',async()=>{
 const original=DB_DEFAULTS.database,ci=process.env.CI;
 const connect=vi.spyOn(pg.Client.prototype,'connect').mockRejectedValue(Error('fixture_unexpected_connect'));
 const query=vi.spyOn(pg.Client.prototype,'query').mockRejectedValue(Error('fixture_unexpected_query'));
 const expose=vi.fn();DB_DEFAULTS.database='other_test';process.env.CI='true';
 try{
  await expect(createPhoneClaimFixture(expose)).rejects.toThrow('phone_claim_fixture_scratch_required');
  expect(connect).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();expect(expose).not.toHaveBeenCalled();
 }finally{
  DB_DEFAULTS.database=original;if(ci===undefined)delete process.env.CI;else process.env.CI=ci;
  connect.mockRestore();query.mockRestore();
 }
});
