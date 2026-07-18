package com.mimic.client.capability

/**
 * Explicit privilege backends for Android (no silent fallback — 铁律 5).
 * normal: MediaProjection + Accessibility
 * shizuku: privileged Display/Input via Shizuku user service
 * root: privileged Display/Input via root Binder service
 */
enum class CapabilityBackend(val id: String) {
    NORMAL("normal"),
    SHIZUKU("shizuku"),
    ROOT("root");

    companion object {
        fun fromId(id: String): CapabilityBackend? =
            entries.firstOrNull { it.id == id }
    }
}

enum class BackendState {
    Unavailable,
    Available,
    Connecting,
    Connected,
    Denied,
    Died,
    Error,
}

data class BackendStatus(
    val backend: CapabilityBackend,
    val state: BackendState,
    val detail: String = "",
)
