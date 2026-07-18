package com.mimic.client.capability

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Explicit privilege backend selector (铁律 5 — no silent fallback).
 * Only `normal` is wired today; shizuku/root return Unavailable until deps land.
 */
class CapabilityManager(private val context: Context) {
    @Volatile var active: CapabilityBackend = CapabilityBackend.NORMAL
        private set

    private val statuses = mutableMapOf(
        CapabilityBackend.NORMAL to BackendStatus(CapabilityBackend.NORMAL, BackendState.Connected, "default"),
        CapabilityBackend.SHIZUKU to BackendStatus(CapabilityBackend.SHIZUKU, BackendState.Unavailable, "not packaged yet"),
        CapabilityBackend.ROOT to BackendStatus(CapabilityBackend.ROOT, BackendState.Unavailable, "not packaged yet"),
    )

    fun statusJson(): JSONObject {
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
        val st = statuses[backend]!!
        if (st.state == BackendState.Unavailable) {
            return JSONObject()
                .put("ok", false)
                .put("error", "android: backend '${backend.id}' unavailable (${st.detail})")
                .put("backend", active.id)
        }
        if (st.state == BackendState.Denied || st.state == BackendState.Error) {
            return JSONObject()
                .put("ok", false)
                .put("error", "android: backend '${backend.id}' ${st.state.name.lowercase()}: ${st.detail}")
                .put("backend", active.id)
        }
        // Fail-closed: refuse to activate shizuku/root until real connector exists.
        if (backend != CapabilityBackend.NORMAL) {
            return JSONObject()
                .put("ok", false)
                .put("error", "android: backend '${backend.id}' not implemented yet")
                .put("backend", active.id)
        }
        active = backend
        return JSONObject().put("ok", true).put("backend", active.id)
    }

    fun mark(backend: CapabilityBackend, state: BackendState, detail: String = "") {
        statuses[backend] = BackendStatus(backend, state, detail)
    }

    fun canVirtualDisplay(): Boolean =
        active == CapabilityBackend.SHIZUKU || active == CapabilityBackend.ROOT
}
