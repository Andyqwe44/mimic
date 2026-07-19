package com.mimic.client.capability

import android.content.Context
import com.mimic.client.privileged.ShizukuConnector
import org.json.JSONArray
import org.json.JSONObject

/**
 * Explicit privilege backend selector (铁律 5 — no silent fallback).
 * normal always available; shizuku when Shizuku app is present + permission.
 */
class CapabilityManager(private val context: Context) {
    @Volatile var active: CapabilityBackend = CapabilityBackend.NORMAL
        private set

    val shizuku = ShizukuConnector(context)

    private val statuses = mutableMapOf(
        CapabilityBackend.NORMAL to BackendStatus(CapabilityBackend.NORMAL, BackendState.Connected, "default"),
        CapabilityBackend.SHIZUKU to BackendStatus(CapabilityBackend.SHIZUKU, BackendState.Unavailable, "probing"),
        CapabilityBackend.ROOT to BackendStatus(CapabilityBackend.ROOT, BackendState.Unavailable, "not implemented yet"),
    )

    init {
        refreshShizukuStatus()
    }

    fun refreshShizukuStatus() {
        val st = when {
            !shizuku.pingAvailable() ->
                BackendStatus(CapabilityBackend.SHIZUKU, BackendState.Unavailable, "shizuku not running")
            !shizuku.permissionGranted() ->
                BackendStatus(CapabilityBackend.SHIZUKU, BackendState.Available, "permission not granted")
            shizuku.isConnected() ->
                BackendStatus(CapabilityBackend.SHIZUKU, BackendState.Connected, "connected")
            else ->
                BackendStatus(CapabilityBackend.SHIZUKU, BackendState.Available, "available")
        }
        statuses[CapabilityBackend.SHIZUKU] = st
    }

    fun statusJson(): JSONObject {
        refreshShizukuStatus()
        val available = JSONArray()
        for ((backend, st) in statuses) {
            if (st.state == BackendState.Connected || st.state == BackendState.Available) {
                available.put(backend.id)
            }
        }
        fun one(b: CapabilityBackend): JSONObject {
            val st = statuses[b]!!
            return JSONObject()
                .put("available", st.state != BackendState.Unavailable)
                .put("granted", st.state == BackendState.Connected)
                .put("state", st.state.name.lowercase())
                .put("detail", st.detail)
        }
        return JSONObject()
            .put("ok", true)
            .put("backend", active.id)
            .put("available", available)
            .put("shizuku", one(CapabilityBackend.SHIZUKU))
            .put("root", one(CapabilityBackend.ROOT))
            .put("normal", one(CapabilityBackend.NORMAL))
    }

    fun setBackend(id: String): JSONObject {
        val backend = CapabilityBackend.fromId(id)
            ?: return JSONObject().put("ok", false).put("error", "unknown backend '$id'")
        refreshShizukuStatus()
        val st = statuses[backend]!!
        if (backend == CapabilityBackend.ROOT) {
            return JSONObject()
                .put("ok", false)
                .put("error", "android: backend 'root' not implemented yet")
                .put("backend", active.id)
        }
        if (backend == CapabilityBackend.SHIZUKU) {
            if (st.state == BackendState.Unavailable) {
                return JSONObject()
                    .put("ok", false)
                    .put("error", "android: backend 'shizuku' unavailable (${st.detail})")
                    .put("backend", active.id)
            }
            val conn = shizuku.connect()
            if (!conn.optBoolean("ok", false)) {
                refreshShizukuStatus()
                return conn.put("backend", active.id)
            }
            refreshShizukuStatus()
            active = CapabilityBackend.SHIZUKU
            return JSONObject().put("ok", true).put("backend", active.id)
        }
        // NORMAL
        if (active == CapabilityBackend.SHIZUKU) {
            shizuku.stopSession()
        }
        active = CapabilityBackend.NORMAL
        return JSONObject().put("ok", true).put("backend", active.id)
    }

    fun ensureShizukuConnected(): JSONObject {
        refreshShizukuStatus()
        if (shizuku.isConnected()) {
            active = CapabilityBackend.SHIZUKU
            return JSONObject().put("ok", true).put("backend", "shizuku")
        }
        val conn = shizuku.connect()
        if (conn.optBoolean("ok", false)) {
            active = CapabilityBackend.SHIZUKU
            refreshShizukuStatus()
        }
        return conn
    }

    fun mark(backend: CapabilityBackend, state: BackendState, detail: String = "") {
        statuses[backend] = BackendStatus(backend, state, detail)
    }

    fun canVirtualDisplay(): Boolean =
        active == CapabilityBackend.SHIZUKU || active == CapabilityBackend.ROOT ||
            (shizuku.pingAvailable() && shizuku.permissionGranted())
}
