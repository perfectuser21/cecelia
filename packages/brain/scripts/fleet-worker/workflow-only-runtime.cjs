'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createLocalLaunchAdmission,createLocalResourceAdmission,wrapLaunchRunner}=require('./local-resource-admission.cjs');
const {runtimeConfigDigest}=require('./runtime-config.cjs');
// 现有公共WorkflowRunner的独立运行面；不初始化其他执行器或虚构镜像身份。
function createWorkflowOnlyRuntime({env,runCommand,protectedTokenFromFile,loadWorkflowModules}){
 const workerId=env.CECELIA_MACHINE_ID;
 if(!['us-mac-m4','xian-mac-m4','xian-mac-m1'].includes(workerId))throw Error('fleet_worker_machine_id_invalid');
 const root=env.CECELIA_FLEET_DATA_ROOT;
 if(typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)===path.parse(root).root)throw Error('fleet_worker_data_root_invalid');
 const dataRoot=path.resolve(root);fs.mkdirSync(dataRoot,{recursive:true,mode:0o700});
 const attemptToken=protectedTokenFromFile(env.CECELIA_FLEET_WORKER_TOKEN_FILE);
 const workflowRoot=env.CECELIA_ORCHESTRATOR_RUNNER_ROOT??path.resolve(__dirname,'../../../..');
 const {loadWorkflowProfiles,createWorkflowRunner,assertProfile,profileDigest}=loadWorkflowModules(workflowRoot);
 if(!env.CECELIA_WORKFLOW_PROFILES_FILE)throw Error('workflow_profiles_required');
 const workflowProfiles=loadWorkflowProfiles(env.CECELIA_WORKFLOW_PROFILES_FILE);
 if(!Object.keys(workflowProfiles).length)throw Error('workflow_profiles_required');
 for(const p of Object.values(workflowProfiles))assertProfile(p,'exploration');
 const launchAdmission=createLocalLaunchAdmission({markerPath:env.CECELIA_DRAIN_MARKER??path.join(dataRoot,'drain')});
 const healthDiskPaths=Object.freeze([dataRoot]);
 const workflowRunner=wrapLaunchRunner(createWorkflowRunner({stateRoot:path.join(dataRoot,'workflows'),machineId:workerId,profiles:workflowProfiles,assertCanLaunch:launchAdmission.assertCanLaunch,
  assertLocalResources:createLocalResourceAdmission({workerId,diskPaths:healthDiskPaths,...(runCommand?{runCommand}:{})}),
  brainUrl:env.CECELIA_WORKFLOW_BRAIN_URL,headers:env.CECELIA_WORKFLOW_BRAIN_TOKEN_FILE?{authorization:`Bearer ${protectedTokenFromFile(env.CECELIA_WORKFLOW_BRAIN_TOKEN_FILE)}`}:{}}),launchAdmission);
 const config={surface:'workflow',workerId,workflowRoot,workflowProfiles,dataRoot,healthDiskPaths};
 return Object.freeze({attemptToken,launchAdmission,healthDiskPaths,workflowRunner,getRuntimeConfigDigest:()=>runtimeConfigDigest(config),
  workflowProfileCatalog:profileId=>{const profile=workflowProfiles[profileId];if(!profile)throw Error('workflow_profile_unavailable');assertProfile(profile,'exploration');return profileDigest(profile);}});
}
module.exports={createWorkflowOnlyRuntime};
