import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {cruise} from 'dependency-cruiser';

// 根扫描器依赖只在npm ci全根的CI来源suite执行；Brain-only单测保留运行配置行为测试。
test('默认运行配置由原生依赖图绑定到实际读取器',async()=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url));
  const readerPath='packages/brain/src/lib/factory-workflow-config.js';
  const configPath='packages/brain/config/factory-workflows.json';
  const result=await cruise([join(root,readerPath)],{baseDir:root,doNotFollow:{path:'node_modules'},exclude:{path:'node_modules'}});
  const graph=typeof result.output==='string'?JSON.parse(result.output):result.output;
  const reader=graph.modules.find(m=>resolve(process.cwd(),m.source)===join(root,readerPath));
  assert.ok(reader);
  assert.equal(reader.dependencies.filter(d=>!d.couldNotResolve&&resolve(process.cwd(),d.resolved)===join(root,configPath)).length,1);
});
