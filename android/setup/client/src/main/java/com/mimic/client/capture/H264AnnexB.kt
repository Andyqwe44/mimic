package com.mimic.client.capture

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Peer LAN H.264 payload: 16-byte LE meta + Annex-B NALs
 * meta = [w:u32][h:u32][flags:u32][ts_ms:u32]  flags bit0 = keyframe
 * Matches pc/client peer_send_h264.
 */
object H264AnnexB {
    fun pack(w: Int, h: Int, keyframe: Boolean, tsMs: Int, annexB: ByteArray): ByteArray {
        val body = ByteArray(16 + annexB.size)
        ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN)
            .putInt(w)
            .putInt(h)
            .putInt(if (keyframe) 1 else 0)
            .putInt(tsMs)
        System.arraycopy(annexB, 0, body, 16, annexB.size)
        return body
    }

    /** Convert length-prefixed AVCC NALs to Annex-B (00 00 00 01). */
    fun avccToAnnexB(data: ByteArray): ByteArray {
        val out = ArrayList<Byte>(data.size + 16)
        var i = 0
        while (i + 4 <= data.size) {
            val len = ((data[i].toInt() and 0xff) shl 24) or
                ((data[i + 1].toInt() and 0xff) shl 16) or
                ((data[i + 2].toInt() and 0xff) shl 8) or
                (data[i + 3].toInt() and 0xff)
            i += 4
            if (len <= 0 || i + len > data.size) break
            out.add(0); out.add(0); out.add(0); out.add(1)
            for (j in 0 until len) out.add(data[i + j])
            i += len
        }
        return out.toByteArray()
    }
}
