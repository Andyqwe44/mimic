package com.mimic.client.input

import android.content.Context
import com.mimic.client.capability.CapabilityBackend
import org.json.JSONObject

/**
 * Input facade — Accessibility (normal) / privileged InputManager (shizuku|root).
 */
class InputController(private val context: Context) {
    fun inject(action: JSONObject, backend: CapabilityBackend): JSONObject {
        return when (backend) {
            CapabilityBackend.NORMAL -> {
                val svc = MimicAccessibilityService.get()
                    ?: return JSONObject()
                        .put("ok", false)
                        .put("error", "android: AccessibilityService not enabled")
                val dm = context.resources.displayMetrics
                svc.injectNormalized(action, dm.widthPixels, dm.heightPixels)
            }
            CapabilityBackend.SHIZUKU, CapabilityBackend.ROOT ->
                JSONObject()
                    .put("ok", false)
                    .put("error", "android: privileged InputManager (${backend.id}) not implemented yet")
        }
    }
}
