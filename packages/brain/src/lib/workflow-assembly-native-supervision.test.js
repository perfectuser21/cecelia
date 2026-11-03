import {describe,it,expect,vi} from 'vitest';
import {runSupervisedNativeRound} from './workflow-assembly-native-supervision.js';
const runId='native:assembly:fixed';
function context(){return {runId,definitionVersion:'version',readback:vi.fn(async()=>({run_id:runId,outcome:'running',definition_version:'version'})),transport:vi.fn(async()=>({action:'none'}))};}
describe('native maintenance uses common Runner under original session lock',()=>{
 it('observes real code execution and sleeps before ledger terminal; unavailable Commander is fail open',async()=>{
  const ctx=context();ctx.transport.mockRejectedValue(Error('offline'));
  let calls=0;const {report,receipt,events}=await runSupervisedNativeRound(async()=>{calls++;return {checked:2,errors:0,skipped_objects:0};},ctx);
  expect(calls).toBe(1);expect(report.checked).toBe(2);expect(receipt.status).toBe('completed');
  expect(ctx.readback).toHaveBeenCalledTimes(2);expect(events.some(e=>e.event_type==='COMMANDER_UNAVAILABLE')).toBe(true);
  expect(events.at(-1).event_type).toBe('COMMANDER_SLEEP');
 });
 it('rejects wrong independent ledger owner before executing',async()=>{
  const ctx=context();ctx.readback.mockResolvedValue({run_id:'other',outcome:'running',definition_version:'version'});
  const execute=vi.fn();const {receipt}=await runSupervisedNativeRound(execute,ctx);
  expect(execute).not.toHaveBeenCalled();expect(receipt.status).toBe('needs_review');
 });
 it('a Commander pass reply cannot override code errors and no retry of writes is invented',async()=>{
  const ctx=context();ctx.transport.mockResolvedValue({action:'approve',status:'done'});
  const execute=vi.fn(async()=>({checked:1,errors:1,skipped_objects:0}));
  const {receipt}=await runSupervisedNativeRound(execute,ctx);
  expect(execute).toHaveBeenCalledTimes(1);expect(receipt.status).toBe('needs_review');
  expect(receipt.activities[0].validator_verdict.verdict).toBe('fail');
 });
 it('records crash and sleeps without claiming code work passed',async()=>{
  const ctx=context();const {receipt,error,events}=await runSupervisedNativeRound(async()=>{throw Error('db gone');},ctx);
  expect(error.message).toBe('db gone');expect(receipt.status).toBe('needs_review');
  expect(events.at(-1).event_type).toBe('COMMANDER_SLEEP');
 });
});
