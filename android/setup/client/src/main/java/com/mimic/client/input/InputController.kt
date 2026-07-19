package com.mimic.client.input

import android.content.Context
import com.mimic.client.capability.CapabilityBackend
import com.mimic.client.capability.CapabilityManager
import org.json.JSONObject

/**
 * Input facade — Accessibility (normal) / privileged InputManager (shizuku VD).
 */
class InputController(
    private val context: Context,
    private val caps: CapabilityManager,
) {
    @Volatile var vdDisplayActive: Boolean = false

    fun inject(action: JSONObject, backend: CapabilityBackend): JSONObject {
        // App sandbox session always uses privileged inject bound to VD displayId.
        if (vdDisplayActive || backend == CapabilityBackend.SHIZUKU || backend == CapabilityBackend.ROOT) {
            if (!caps.shizuku.isConnected()) {
                return JSONObject()
                    .put("ok", false)
                    .put("error", "android: privileged inject requires Shizuku session")
            }
            return caps.shizuku.inject(action)
        }
        val svc = MimicAccessibilityService.get()
            ?: return JSONObject()
                .put("ok", false)
                .put("error", "android: AccessibilityService not enabled")
        val dm = context.resources.displayMetrics
        return svc.injectNormalized(action, dm.widthPixels, dm.heightPixels)
    }
}
