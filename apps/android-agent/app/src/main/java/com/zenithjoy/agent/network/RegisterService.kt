package com.zenithjoy.agent.network

import android.os.Build
import com.google.gson.Gson
import com.zenithjoy.agent.config.AgentConfig
import com.zenithjoy.agent.config.ConfigStore
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

data class RegisterResult(
    val ok: Boolean,
    val wsToken: String,
    val machineId: String,
    val tier: String?,
    val maxMachines: Int?,
    val agentUuid: String?,
)

/**
 * POST /api/agent/register
 *
 * 请求体：{ license_key, machine_id, hostname, agent_id, version }
 * 响应体：{ ok, ws_token, registered_machine_id, tier, max_machines, agent_id }
 *
 * 对齐 zenithjoy/services/agent/src/index.ts#registerWithLicense
 */
class RegisterService(
    private val httpClient: OkHttpClient = defaultClient(),
    private val gson: Gson = Gson(),
) {

    private data class RegisterRequest(
        val license_key: String,
        val machine_id: String,
        val hostname: String?,
        val agent_id: String?,
        val version: String,
    )

    private data class RegisterResponse(
        val ok: Boolean = false,
        val ws_token: String? = null,
        val registered_machine_id: String? = null,
        val tier: String? = null,
        val max_machines: Int? = null,
        val agent_id: String? = null,
        val code: String? = null,
        val message: String? = null,
    )

    @Throws(IOException::class)
    fun register(cfg: AgentConfig, machineId: String): RegisterResult? {
        val url = "${cfg.httpBase}/api/agent/register"
        val body = RegisterRequest(
            license_key = cfg.licenseKey,
            machine_id = machineId,
            hostname = Build.MODEL,
            agent_id = cfg.agentId,
            version = ConfigStore.VERSION,
        )

        val req = Request.Builder()
            .url(url)
            .post(gson.toJson(body).toRequestBody(JSON))
            .build()

        val resp = httpClient.newCall(req).execute()
        val responseBody = resp.body?.string() ?: return null

        val parsed = gson.fromJson(responseBody, RegisterResponse::class.java) ?: return null

        if (!parsed.ok || parsed.ws_token == null) {
            return null
        }

        return RegisterResult(
            ok = true,
            wsToken = parsed.ws_token,
            machineId = parsed.registered_machine_id ?: machineId,
            tier = parsed.tier,
            maxMachines = parsed.max_machines,
            agentUuid = parsed.agent_id,
        )
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .build()
    }
}
