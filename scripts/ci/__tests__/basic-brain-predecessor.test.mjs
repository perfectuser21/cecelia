import test from 'node:test';
import assert from 'node:assert/strict';
import {runPredecessorScenario} from './helpers/brain-deploy-predecessor.fixture.mjs';

// 旧容器已明确exited：不是可声明健康的前驱；版本文件仅是构建/尝试历史。
// 完整脚本必须保留真实失败，不能猜可变tag另起一个所谓旧版。
for(const branch of ['compose','health'])for(const source of ['unpublished','same-version']){
 test(`${branch}失败：${source}版本历史不得授权第二次compose或伪造恢复`,t=>{
  const f=runPredecessorScenario(t,`${branch}-${source}`);
  assert.equal(f.signal,null,'必须是脚本自己退出，不能靠测试超时冒充失败');
  assert.notEqual(f.exit_code,0);
  assert.match(f.stdout,/STAGING_VERIFIED/,'真实候选准入已完成，必须实际进入生产分支');
  assert.equal(f.status.status,'failed');
  assert.equal(f.compose[0].release_image,f.candidate.image,'首次启动必须用不可变候选ID');
  assert.equal(f.compose.length,1,JSON.stringify(f.compose));
  assert.doesNotMatch(f.stdout,/Rolled back/);
 });
}
test('恢复compose自身失败不能被吞掉后打印Rolled back',t=>{
 const f=runPredecessorScenario(t,'compose-restore-fails');
 assert.equal(f.signal,null);assert.notEqual(f.exit_code,0);assert.equal(f.status.status,'failed');
 assert.doesNotMatch(f.stdout,/Rolled back/,'不可吞恢复失败并声称已恢复');
 assert.equal(f.compose.length,1,'无健康前驱根本不能尝试历史猜测恢复');
});
test('当前镜像读取未知不能成为猜版本回退的授权',t=>{
 const f=runPredecessorScenario(t,'unknown-current-image');
 assert.equal(f.signal,null);assert.notEqual(f.exit_code,0);assert.equal(f.status.status,'failed');
 assert.equal(f.compose.length,1,'已知stopped不要求未知image被当成可自动恢复前驱');
 assert.doesNotMatch(f.stdout,/Rolled back/);
});
test('容器状态查询未知必须拒绝生产compose，不伪装成不存在',t=>{
 const f=runPredecessorScenario(t,'unknown-container-query');
 assert.equal(f.signal,null);assert.notEqual(f.exit_code,0);
 assert.equal(f.compose.length,0);assert.equal(f.status.status,'failed');
});
for(const branch of ['compose','health'])test(`${branch}失败且无版本历史：不得stop现存容器`,t=>{
 const f=runPredecessorScenario(t,`${branch}-no-history`);
 assert.equal(f.signal,null);assert.notEqual(f.exit_code,0);assert.equal(f.status.status,'failed');
 assert.equal(f.compose.length,1,JSON.stringify(f.compose));
 assert.ok(!f.compose.some(c=>c.args.includes('stop')));
 assert.doesNotMatch(f.stdout,/Rolled back/);
});

test('sidecar接管后parent存活也不得再次compose、猜回滚或写部署终态',t=>{
 const r=runPredecessorScenario(t,'handoff-parent-survives');
 assert.match(r.handoff_events,/sidecar-started/);assert.match(r.handoff_events,/blue-removed/);
 assert.notEqual(r.exit_code,0);assert.match(r.stdout+r.stderr,/HANDOFF_UNCONFIRMED/);
 assert.deepEqual(r.compose,[],'parent不得与sidecar竞争compose');assert.equal(r.status,null,'sidecar已接管，parent不能写第二个终态');
 assert.doesNotMatch(r.stdout,/Rolled back|Deploy SUCCESS/);
});
