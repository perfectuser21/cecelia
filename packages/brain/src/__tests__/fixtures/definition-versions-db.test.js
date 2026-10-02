import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({config:{database:'cecelia_scratch',host:'/tmp'},queries:[],connects:0,ends:0,fail:false}));
vi.mock('../../db-config.js',()=>({DB_DEFAULTS:state.config}));
vi.mock('pg',()=>({default:{Client:class{
 async connect(){state.connects++;}
 async query(sql){state.queries.push(sql);const match=sql.match(/SET search_path TO ([a-z0-9_]+)/);if(match)state.schema=match[1];if(state.fail&&/CREATE TABLE/.test(sql))throw Error('fixture_setup_failure');if(/LIKE\s+public\./i.test(sql))throw Error('forbidden_public_copy');return {rows:[{name:state.config.database,database:state.config.database,schema:state.schema}],rowCount:1};}
 async end(){state.ends++;}
}}}));
import {versionsDatabase} from './definition-versions-db.js';
beforeEach(()=>{state.config.database='cecelia_scratch';state.config.host='/tmp';state.queries=[];state.connects=0;state.ends=0;state.fail=false;vi.unstubAllEnvs();vi.stubEnv('CI','');});
it.each([['other_test','true'],['cecelia_test',''],['cecelia','true'],['cecelia_scratch','fake'],['cecelia_scratch','false'],['cecelia_scratch','1']])('unsafe target %s/CI=%s is rejected before any connect',async(database,ci)=>{
 state.config.database=database;vi.stubEnv('CI',ci);if(database==='cecelia_scratch')state.config.host='localhost';
 await expect(versionsDatabase()).rejects.toThrow();expect(state.connects).toBe(0);expect(state.queries).toEqual([]);
});
it('non-CI scratch remote host is rejected before connect',async()=>{
 state.config.host='localhost';await expect(versionsDatabase()).rejects.toThrow();expect(state.connects).toBe(0);
});
it('initialization builds private actual schema without copying public and close never sets public',async()=>{
 const fixture=await versionsDatabase();await fixture.close();expect(state.queries.some(q=>/LIKE\s+public\.|SET\s+search_path\s+TO\s+public/i.test(q))).toBe(false);expect(state.ends).toBeGreaterThan(0);
});
it('setup failure rolls back and cleans only its own schema and connected client',async()=>{
 state.fail=true;await expect(versionsDatabase()).rejects.toThrow('fixture_setup_failure');expect(state.queries).toContain('ROLLBACK');expect(state.queries.some(q=>/^DROP SCHEMA.*versions_[a-f0-9]+.*CASCADE/.test(q))).toBe(true);expect(state.ends).toBeGreaterThan(0);
});
