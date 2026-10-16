/** 正式获客手机资源边界；host不代表有无手机，103始终无手机。 */
export const isLeadgenPhoneFlow = key => ['douyin_video_discovery','douyin_video_processing','douyin_lead_outreach'].includes(key);
export function isTcpPhoneSerial(value) {
  if(typeof value!=='string')return false;
  const m=/^((?:[0-9]{1,3}\.){3}[0-9]{1,3}):([1-9][0-9]{0,4})$/.exec(value);
  return !!m&&m[1].split('.').every(n=>String(Number(n))===n&&Number(n)<=255)&&Number(m[2])<=65535;
}
export const isPhoneRegistrySerial = value => typeof value==='string'&&(/^[A-Za-z0-9._-]{1,64}$/.test(value)||isTcpPhoneSerial(value));
export const isMmvRegistry = value => typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\.tsv$/.test(value);
export const isMmvInstance = value => typeof value==='string'&&/^acp-[a-z0-9]{1,64}$/.test(value);
export const isApprovedAdbPort = value => Number.isSafeInteger(value)&&[5037,5041,5042].includes(value);
export const leadgenDeviceLocks = plan => isLeadgenPhoneFlow(plan.workflow_key)?[...new Set([plan.serial,...(plan.machine==='mmv'?[plan.device_instance_id]:[])])].sort():[];
