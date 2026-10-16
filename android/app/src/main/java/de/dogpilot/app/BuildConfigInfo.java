package de.dogpilot.app;

import android.content.Context;

final class BuildConfigInfo {
    static String version(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; }
        catch (Exception e) { return "?"; }
    }
}
