package com.mimic.client;

interface IMimicFrameCallback {
    void onFrame(in byte[] packed);
    void onSessionEnded(String reason);
}
