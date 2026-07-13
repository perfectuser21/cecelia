package com.zenithjoy.agent.ui

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.zenithjoy.agent.R
import com.zenithjoy.agent.config.AgentConfig
import com.zenithjoy.agent.config.ConfigStore
import com.zenithjoy.agent.service.AgentService

/**
 * 首次启动配置界面：输入 license key → 写 config → 启动 AgentService。
 *
 * 生命周期：已配置时直接启动服务跳过界面。
 */
class SetupActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val store = ConfigStore(this)
        val existingCfg = store.load()
        if (existingCfg != null) {
            launchService()
            finish()
            return
        }

        setContentView(R.layout.activity_setup)
        val licenseInput = findViewById<EditText>(R.id.license_input)
        val submitButton = findViewById<Button>(R.id.submit_button)
        val statusText = findViewById<TextView>(R.id.status_text)

        submitButton.setOnClickListener {
            val key = licenseInput.text.toString().trim()
            if (!isValidLicenseFormat(key)) {
                statusText.text = "License 格式不合法（应为 ZJ-X-XXXXXXXX）"
                return@setOnClickListener
            }

            val cfg = AgentConfig(
                licenseKey = key,
                agentId = ConfigStore.buildDefaultAgentId(),
                wsUrl = ConfigStore.DEFAULT_WS_URL,
                httpBase = ConfigStore.DEFAULT_HTTP_BASE,
                loggedInAt = System.currentTimeMillis(),
            )
            store.save(cfg)
            launchService()
            Toast.makeText(this, "Agent 已启动", Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    private fun launchService() {
        startForegroundService(Intent(this, AgentService::class.java))
    }

    private fun isValidLicenseFormat(key: String): Boolean =
        Regex("^ZJ-[A-Z]+-[A-Z0-9]+$").matches(key)
}
