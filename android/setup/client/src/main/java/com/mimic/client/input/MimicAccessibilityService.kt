package com.mimic.client.input

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.view.accessibility.AccessibilityEvent
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * User-enabled AccessibilityService for normal-backend tap/swipe injection.
 * No silent fallback to privileged InputManager (铁律 5).
 */
class MimicAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() {
        instance = WeakReference(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    override fun onDestroy() {
        if (instance?.get() === this) instance = null
        super.onDestroy()
    }

    fun injectNormalized(action: JSONObject, screenW: Int, screenH: Int): JSONObject {
        val type = action.optString("type", "")
        val x = (action.optDouble("x_norm", action.optDouble("x", 0.5)).coerceIn(0.0, 1.0) * screenW).toFloat()
        val y = (action.optDouble("y_norm", action.optDouble("y", 0.5)).coerceIn(0.0, 1.0) * screenH).toFloat()
        return when (type) {
            "mousedown", "mouseup", "click", "tap" -> {
                if (Build.VERSION.SDK_INT < 24) {
                    return JSONObject().put("ok", false).put("error", "gesture API requires API 24+")
                }
                val path = Path().apply { moveTo(x, y) }
                val stroke = GestureDescription.StrokeDescription(path, 0, 50)
                val gesture = GestureDescription.Builder().addStroke(stroke).build()
                val ok = dispatchGesture(gesture, null, null)
                JSONObject().put("ok", ok).put("type", type)
                    .apply { if (!ok) put("error", "dispatchGesture failed") }
            }
            "move", "drag" -> {
                JSONObject().put("ok", false).put("error", "android: drag gesture not implemented yet")
            }
            "keydown", "keyup", "text" -> {
                JSONObject().put("ok", false).put("error", "android: key/text injection via a11y not implemented yet")
            }
            else -> JSONObject().put("ok", false).put("error", "unknown input type '$type'")
        }
    }

    companion object {
        @Volatile private var instance: WeakReference<MimicAccessibilityService>? = null

        fun get(): MimicAccessibilityService? = instance?.get()

        fun isEnabled(): Boolean = get() != null
    }
}
