import { randomUUID } from 'node:crypto';

/** 原值条件防止覆盖并发修改；配置和事件在同一事务提交。 */
export async function persistAgentModelChange(pool, { profile, config, agent, previous, current, actor, sessionId }) {
  const client = await pool.connect();
  let transactionError;
  try {
    await client.query('BEGIN');
    const { rows: [written] } = await client.query(
      'UPDATE model_profiles SET config = $1, updated_at = NOW() WHERE id = $2 AND is_active = true AND config = $3::jsonb RETURNING id, name, config, is_active',
      [JSON.stringify(config), profile.id, JSON.stringify(profile.config)]
    );
    if (!written) throw new Error('配置已变更或不再生效，修改冲突，请重新读取');
    const { rows: [readBack] } = await client.query(
      'SELECT id, name, config, is_active FROM model_profiles WHERE id = $1 AND is_active = true', [written.id]
    );
    const actual = agent.layer === 'brain'
      ? readBack?.config[agent.id]
      : {
        provider: readBack?.config.executor?.fixed_provider?.[agent.id] || readBack?.config.executor?.default_provider,
        model: readBack?.config.executor?.model_map?.[agent.id]?.[current.provider],
      };
    if (actual?.provider !== current.provider || actual?.model !== current.model) {
      throw new Error('模型配置数据库读回验证失败');
    }
    const receipt = {
      id: randomUUID(), agent_id: agent.id, profile_id: written.id,
      previous, current, verified: true, verified_at: new Date().toISOString(),
      actor: actor || 'api', session_id: sessionId || null,
    };
    await client.query(
      "INSERT INTO cecelia_events (event_type, source, payload) VALUES ('agent_model_changed', 'model-profile', $1::jsonb)",
      [JSON.stringify(receipt)]
    );
    await client.query('COMMIT');
    return { profile: readBack, receipt };
  } catch (error) {
    transactionError = error;
    try { await client.query('ROLLBACK'); } catch { /* 原错误优先，丢弃连接 */ }
    throw error;
  } finally {
    client.release(transactionError);
  }
}
