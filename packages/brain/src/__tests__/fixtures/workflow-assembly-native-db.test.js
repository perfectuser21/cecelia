import {it,expect} from 'vitest';
import {nativeMaintenanceDatabase} from './workflow-assembly-native-db.js';

it('native夹具的真实入口拒绝生产库，连接/建schema之前停止',async()=>{
  const previous=process.env.DB_NAME;
  try{
    process.env.DB_NAME='cecelia';
    await expect(nativeMaintenanceDatabase()).rejects.toThrow('仅允许本机cecelia_scratch或CI隔离cecelia_test');
  }finally{if(previous===undefined)delete process.env.DB_NAME;else process.env.DB_NAME=previous;}
});
