package com.mimic.client.input

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * User-enabled AccessibilityService for normal-backend tap/swipe injection.
 * When [confinePackage] is set (app target), leaving that package triggers re-launch
 * so the controller cannot drive the user to Home / other apps.
 */
class MimicAccessibilityService : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private var lastRelaunchMs = 0L

    override fun onServiceConnected() {
        instance = WeakReference(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val pkgConfine = confinePackage ?: return
        if (event == null) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOWS_CHANGED
        ) {
            return
        }
        val pkg = event.packageName?.toString() ?: return
        if (pkg == pkgConfine) return
        if (pkg == ourPackage) return
        if (pkg in SYSTEM_IGNORE) return
        // Debounce relaunch storms (launcher animations, permission sheets).
        val now = System.currentTimeMillis()
        if (now - lastRelaunchMs < 800) return
        lastRelaunchMs = now
        Log.i(TAG, "confine: left $pkgConfine → saw $pkg; re-launch")
        val act = confineActivity
        main.post {
            relaunchConfined?.invoke(pkgConfine, act)
        }
    }

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
                // Treat held move as a short tap-drag toward the point (best-effort).
                if (Build.VERSION.SDK_INT < 24) {
                    return JSONObject().put("ok", false).put("error", "gesture API requires API 24+")
                }
                val path = Path().apply { moveTo(x, y); lineTo(x, y) }
                val stroke = GestureDescription.StrokeDescription(path, 0, 30)
                val gesture = GestureDescription.Builder().addStroke(stroke).build()
                val ok = dispatchGesture(gesture, null, null)
                JSONObject().put("ok", ok).put("type", type)
            }
            "keydown", "keyup", "text" -> {
                JSONObject().put("ok", false).put("error", "android: key/text injection via a11y not implemented yet")
            }
            else -> JSONObject().put("ok", false).put("error", "unknown input type '$type'")
        }
    }

    companion object {
        private const val TAG = "MimicA11y"
        private val SYSTEM_IGNORE = setOf(
            "com.android.systemui",
            "com.android.permissioncontroller",
            "com.google.android.permissioncontroller",
            "com.android.settings",
            "com.google.android.packageinstaller",
            "com.android.packageinstaller",
            "com.samsung.android.app.telephonyui",
            "com.android.phone",
        )

        @Volatile private var instance: WeakReference<MimicAccessibilityService>? = null
        @Volatile var confinePackage: String? = null
            private set
        @Volatile var confineActivity: String? = null
            private set
        @Volatile var ourPackage: String = ""
        @Volatile var relaunchConfined: ((pkg: String, activity: String?) -> Unit)? = null

        fun get(): MimicAccessibilityService? = instance?.get()

        fun isEnabled(): Boolean = get() != null

        fun setConfine(packageName: String?, activity: String?) {
            confinePackage = packageName?.ifBlank { null }
            confineActivity = activity?.ifBlank { null }
            Log.i(TAG, "confine=${confinePackage ?: "(none)"}")
        }

        fun clearConfine() = setConfine(null, null)
    }
}
