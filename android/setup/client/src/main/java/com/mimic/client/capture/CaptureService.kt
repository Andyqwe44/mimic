package com.mimic.client.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground service required for MediaProjection on modern Android.
 * Actual VirtualDisplay + MediaCodec wiring lands in CaptureController.
 */
class CaptureService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureChannel()
        val n: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("Mimic")
            .setContentText("Screen capture active")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setOngoing(true)
            .build()
        startForeground(NOTIF_ID, n)
        return START_STICKY
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val mgr = getSystemService(NotificationManager::class.java) ?: return
        mgr.createNotificationChannel(
            NotificationChannel(CHANNEL, "Capture", NotificationManager.IMPORTANCE_LOW),
        )
    }

    companion object {
        const val CHANNEL = "mimic_capture"
        const val NOTIF_ID = 42
    }
}
