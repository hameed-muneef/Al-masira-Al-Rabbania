// src/lib/settings-opener.ts
// Wrapper for the local Capacitor plugin SettingsOpener (Kotlin).
// On web (no native), falls back to { opened: false }.
import { registerPlugin } from '@capacitor/core';

interface SettingsOpenerPlugin {
  openAppSettings(): Promise<{ opened: boolean; error?: string }>;
  openBatterySettings(): Promise<{ opened: boolean; error?: string }>;
}

const SettingsOpener = registerPlugin<SettingsOpenerPlugin>('SettingsOpener');

export async function openAppSettings(): Promise<{ opened: boolean; error?: string }> {
  try {
    if (typeof (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform !== 'function'
      || !(window as unknown as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor.isNativePlatform()) {
      return { opened: false, error: 'not-native' };
    }
    return await SettingsOpener.openAppSettings();
  } catch (e) {
    return { opened: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function openBatterySettings(): Promise<{ opened: boolean; error?: string }> {
  try {
    if (typeof (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform !== 'function'
      || !(window as unknown as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor.isNativePlatform()) {
      return { opened: false, error: 'not-native' };
    }
    return await SettingsOpener.openBatterySettings();
  } catch (e) {
    return { opened: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}
