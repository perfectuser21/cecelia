export interface ModelValue {
  provider: string;
  model: string;
}

export interface ModelChangeReceipt {
  id: string;
  verified: true;
  actor: string;
  verified_at: string;
  previous: ModelValue;
  current: ModelValue;
}

function matches(value: ModelValue | undefined, expected: ModelValue) {
  return value?.provider === expected.provider && value?.model === expected.model;
}

export async function saveAndVerifyModel<T extends { id: string; config: object }>(
  agentId: string, modelId: string, provider: string,
): Promise<{ profile: T; receipt: ModelChangeReceipt }> {
  const response = await fetch('/api/brain/model-profiles/active/agent', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: agentId, model_id: modelId, provider }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || '保存失败');

  try {
    const activeResponse = await fetch('/api/brain/model-profiles/active', { cache: 'no-store' });
    if (!activeResponse.ok) throw new Error('当前配置读取失败');
    const active = await activeResponse.json();
    const expected = { model: modelId, provider };
    if (!active.success || !matches(active.profile?.config?.[agentId], expected)
      || (result.profile?.id && result.profile.id !== active.profile?.id)) {
      throw new Error('读回配置与本次修改不一致');
    }
    const receipt = result.receipt as ModelChangeReceipt | undefined;
    if (!receipt?.id || receipt.verified !== true || !receipt.actor || !receipt.verified_at
      || !receipt.previous?.model || !receipt.previous?.provider || !matches(receipt.current, expected)) {
      throw new Error('后台变更记录未确认');
    }
    return { profile: active.profile, receipt };
  } catch (error) {
    throw new Error(`未确认生效：${error instanceof Error ? error.message : '验证失败'}。请刷新当前配置后再决定是否重试。`);
  }
}
