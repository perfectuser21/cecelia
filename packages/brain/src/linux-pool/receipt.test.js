import { it,expect } from 'vitest';
import { verifyCanaryEnvelope } from './receipt.js';
it('不可信回执错误只返回固定码，不回显原文、签名或认证token',()=>{
 const token='a'.repeat(64);
 for(const envelope of [null,{receipt:{secret:'payload-secret'},signature:'b'.repeat(64)},{receipt:'payload-secret',signature:'invalid'}]){
  expect(()=>verifyCanaryEnvelope(envelope,{}, {token,expected:{}},Date.now())).toThrow(/^linux_pool_receipt_invalid$/);
 }
});
