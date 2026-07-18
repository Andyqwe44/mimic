package com.mimic.client.target

import org.json.JSONObject

/**
 * Cross-platform capture/control target (peer protocol v2).
 * Windows HWND is an optional alias for platform=windows only.
 */
data class TargetDescriptor(
    val id: String,
    val platform: String = "android",
    val kind: String, // display | app | desktop | window
    val title: String,
    val packageName: String? = null,
    val activity: String? = null,
    val displayId: Int? = null,
    val hwnd: Long? = null,
    val capture: Boolean = false,
    val control: Boolean = false,
    val launch: Boolean = false,
    val virtualDisplay: Boolean = false,
) {
    fun toJson(): JSONObject {
        val o = JSONObject()
            .put("id", id)
            .put("platform", platform)
            .put("kind", kind)
            .put("title", title)
        if (packageName != null) o.put("packageName", packageName)
        if (activity != null) o.put("activity", activity)
        if (displayId != null) o.put("displayId", displayId)
        if (hwnd != null) o.put("hwnd", hwnd)
        o.put(
            "capabilities",
            JSONObject()
                .put("capture", capture)
                .put("control", control)
                .put("launch", launch)
                .put("virtualDisplay", virtualDisplay),
        )
        return o
    }
}
