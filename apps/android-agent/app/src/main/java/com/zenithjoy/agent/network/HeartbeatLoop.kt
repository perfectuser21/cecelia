package com.zenithjoy.agent.network

import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import com.zenithjoy.agent.config.AgentConfig
import com.zenithjoy.agent.config.ConfigStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

data class HeartbeatTask(
    @SerializedName("task_id") val taskId: String,
    val platform: String,
    val type: String?,
    val payload: Map<String, Any?>,
)

data class HeartbeatResponse(
    val ok: Boolean = false,
    @SerializedName("agent_id") val agentId: String? = null,
    @SerializedName("queued_tasks") val queuedTasks: List<HeartbeatTask>? = null,
)

/**
 * HTTP 心跳 — POST /api/agent/heartbeat，每 30s 一次。
 *
 * 对齐 zenithjoy/services/agent/src/handlers/heartbeat-loop.ts 协议：
 *   请求体：{ license, version, hostname, agent_id?, agent_uuid?, machine_id?, os_type }
 *   响应体：{ ok, agent_id, queued_tasks?, modules?, required_agent_version? }
 */
class HeartbeatLoop(
    private val cfg: AgentConfig,
    private val machineId: String,
    private val intervalMs: Long = 30_000L,
    private val httpClient: OkHttpClient = RegisterService.defaultClient(),
    private val gson: Gson = Gson(),
    private val onTask: ((HeartbeatTask) -> Unit)? = null,
    private val onError: ((Throwable) -> Unit)? = null,
) {
    private var job: Job? = null
    private var resolvedAgentId: String? = cfg.agentUuid

    fun start(scope: CoroutineScope) {
        job = scope.launch(Dispatchers.IO) {
            while (isActive) {
                runCatching { tick() }.onFailure { onError?.invoke(it) }
                delay(intervalMs)
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    private fun tick() {
        val body = buildMap<String, Any?> {
            put("license", cfg.licenseKey)
            put("version", ConfigStore.VERSION)
            put("hostname", android.os.Build.MODEL)
            put("os_type", "android")
            resolvedAgentId?.let { put("agent_id", it) }
            cfg.agentUuid?.let { put("agent_uuid", it) }
            cfg.machineId?.let { put("machine_id", it) } ?: put("machine_id", machineId)
        }

        val req = Request.Builder()
            .url("${cfg.httpBase}/api/agent/heartbeat")
            .post(gson.toJson(body).toRequestBody(JSON))
            .build()

        val resp = httpClient.newCall(req).execute()
        if (!resp.isSuccessful) {
            onError?.invoke(RuntimeException("heartbeat http ${resp.code}"))
            return
        }

        val parsed = gson.fromJson(resp.body?.string(), HeartbeatResponse::class.java) ?: return
        if (!parsed.ok || parsed.agentId == null) {
            onError?.invoke(RuntimeException("heartbeat response missing ok/agent_id"))
            return
        }

        resolvedAgentId = parsed.agentId
        parsed.queuedTasks?.forEach { onTask?.invoke(it) }
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
