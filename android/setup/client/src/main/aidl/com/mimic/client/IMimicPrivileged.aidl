package com.mimic.client;

import com.mimic.client.IMimicFrameCallback;

interface IMimicPrivileged {
    String startAppSession(String packageName, String activity, int width, int height, int dpi, IMimicFrameCallback cb);
    void stopSession();
    String injectJson(String actionJson);
    int getDisplayId();
    boolean isRunning();
    void requestKeyframe();
}
