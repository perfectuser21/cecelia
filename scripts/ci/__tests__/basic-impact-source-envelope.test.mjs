// 真实固定Git来源集合回归进入既有必需scripts跑道；不新增workflow/job。
import './workspace-ci-source-bundle.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {commandsFor} from '../run-basic-check.mjs';
test('必需scripts入口执行当前Impact封套与全部历史兼容负例',()=>{
 assert.ok(commandsFor('scripts').some(step=>step.args.includes('scripts/ci/__tests__/basic-impact-source-envelope.test.mjs')));
});
