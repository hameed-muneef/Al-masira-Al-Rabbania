package com.alrabbaniyoon.app;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SettingsOpener")
public class SettingsOpenerPlugin extends Plugin {

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (getActivity() != null) {
                getActivity().startActivity(intent);
            } else {
                getContext().startActivity(intent);
            }
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            ret.put("opened", false);
            ret.put("error", e.getMessage() != null ? e.getMessage() : "unknown");
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (getActivity() != null) {
                getActivity().startActivity(intent);
            } else {
                getContext().startActivity(intent);
            }
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            ret.put("opened", false);
            ret.put("error", e.getMessage() != null ? e.getMessage() : "unknown");
            call.resolve(ret);
        }
    }
}
