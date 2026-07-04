package com.zenithjoy.agent.config

import android.content.Context
import android.content.SharedPreferences
import android.os.Build

private const val PREFS_NAME = "zenithjoy_agent_config"

data class AgentConfig(
    val licenseKey: String,
    val agentId: String,
    val wsUrl: String,
    val httpBase: String,
    val loggedInAt: Long,
    val wsToken: String? = null,
    val machineId: String? = null,
    val tier: String? = null,
    val maxMachines: Int? = null,
    val agentUuid: String? = null,
)

class ConfigStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun load(): AgentConfig? {
        val licenseKey = prefs.getString("license_key", null) ?: return null
        return AgentConfig(
            licenseKey = licenseKey,
            agentId = prefs.getString("agent_id", null) ?: buildDefaultAgentId(),
            wsUrl = prefs.getString("ws_url", null) ?: DEFAULT_WS_URL,
            httpBase = prefs.getString("http_base", null) ?: DEFAULT_HTTP_BASE,
            loggedInAt = prefs.getLong("logged_in_at", 0L),
            wsToken = prefs.getString("ws_token", null),
            machineId = prefs.getString("machine_id", null),
            tier = prefs.getString("tier", null),
            maxMachines = if (prefs.contains("max_machines")) prefs.getInt("max_machines", 0) else null,
            agentUuid = prefs.getString("agent_uuid", null),
        )
    }

    fun save(cfg: AgentConfig) {
        prefs.edit().apply {
            putString("license_key", cfg.licenseKey)
            putString("agent_id", cfg.agentId)
            putString("ws_url", cfg.wsUrl)
            putString("http_base", cfg.httpBase)
            putLong("logged_in_at", cfg.loggedInAt)
            cfg.wsToken?.let { putString("ws_token", it) }
            cfg.machineId?.let { putString("machine_id", it) }
            cfg.tier?.let { putString("tier", it) }
            cfg.maxMachines?.let { putInt("max_machines", it) }
            cfg.agentUuid?.let { putString("agent_uuid", it) }
            apply()
        }
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        const val DEFAULT_WS_URL = "wss://api.zenithjoy.com/agent-ws"
        const val DEFAULT_HTTP_BASE = "https://api.zenithjoy.com"
        const val VERSION = "1.0.0-android"

        fun buildDefaultAgentId(): String {
            val model = Build.MODEL.replace(Regex("[^a-zA-Z0-9]"), "-").lowercase()
            return "android-$model"
        }
    }
}
