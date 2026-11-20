// src/notifications/native-prayer-scheduler.ts
// جدولة أذان الصلاة via @capacitor/local-notifications (Android/iOS).
// تعمل فقط في بيئة Capacitor (native). في الويب تُتجاهل (no-op).
import { computePrayerSchedule, prayerNameAr, prayerId, type PrayerMethod, type PrayerMadhab } from '../lib/prayer-schedule';
import type { PrayerLocation } from '../prayer-location';
import type { NotificationPreference, PrayerName } from './types';

export const ADHAN_CHANNEL_ID = 'al-rabbani-adhan';
export const GENERAL_CHANNEL_ID = 'al-rabbani-general';

export interface NativeScheduleOptions {
  location: PrayerLocation;
  prefs: NotificationPreference;
  days?: number; // 7..14
  method?: PrayerMethod;
  madhab?: PrayerMadhab;
}

export interface NativeScheduleResult {
  scheduled: number;
  cancelled: number;
  warning?: string;
  permission: 'granted' | 'denied' | 'prompt';
  exactAlarm: 'granted' | 'denied' | 'unsupported';
}

function isNative(): boolean {
  return typeof (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform === 'function'
    && !!(window as unknown as { Capacitor: { isNativePlatform: () => boolean } }).Capacitor.isNativePlatform();
}

async function loadPlugin() {
  try {
    const mod = await import('@capacitor/local-notifications');
    return mod.LocalNotifications;
  } catch {
    return null;
  }
}

export async function ensureChannels(): Promise<void> {
  const LN = await loadPlugin();
  if (!LN) return;
  try {
    await LN.createChannel({ id: ADHAN_CHANNEL_ID, name: 'الأذان', description: 'تنبيهات مواقيت الصلاة والأذان', importance: 5, sound: 'adhan.mp3', vibration: true, lights: true, lightColor: '#D4B678' });
  } catch { /* channel may already exist */ }
  try {
    await LN.createChannel({ id: GENERAL_CHANNEL_ID, name: 'تنبيهات عامة', description: 'تذكيرات وتنبيهات عامة', importance: 3, vibration: true });
  } catch { /* ignore */ }
}

export async function checkPermissions(): Promise<{ display: string; exact: string }> {
  const LN = await loadPlugin();
  if (!LN) return { display: 'unsupported', exact: 'unsupported' };
  let display = 'prompt';
  let exact = 'unsupported';
  try {
    const p = await LN.checkPermissions();
    display = p.display;
  } catch { /* ignore */ }
  try {
    const e = await LN.checkExactNotificationSetting();
    exact = e.exact_alarm;
  } catch { /* ignore */ }
  return { display, exact };
}

export async function requestPermissions(): Promise<{ display: string; exact: string }> {
  const LN = await loadPlugin();
  if (!LN) return { display: 'unsupported', exact: 'unsupported' };
  try {
    const p = await LN.requestPermissions();
    // requestPermissions returns PermissionStatus { display }
    const display = (p as { display?: string }).display ?? 'prompt';
    let exact = 'unsupported';
    try {
      const e = await LN.checkExactNotificationSetting();
      exact = e.exact_alarm;
      if (exact !== 'granted') {
        try { await LN.changeExactNotificationSetting(); } catch { /* ignore */ }
        const e2 = await LN.checkExactNotificationSetting();
        exact = e2.exact_alarm;
      }
    } catch { /* ignore */ }
    return { display, exact };
  } catch {
    return { display: 'denied', exact: 'denied' };
  }
}

export async function schedulePrayerNotifications(opts: NativeScheduleOptions): Promise<NativeScheduleResult> {
  const LN = await loadPlugin();
  if (!LN) {
    return { scheduled: 0, cancelled: 0, permission: 'unsupported' as never, exactAlarm: 'unsupported', warning: 'المنبهات الأصلية غير متاحة (ويب).' };
  }
  await ensureChannels();
  const days = Math.max(7, Math.min(14, opts.days ?? 10));
  const schedule = computePrayerSchedule(
    { latitude: opts.location.latitude, longitude: opts.location.longitude },
    new Date(),
    days,
    (opts.method ?? 'MuslimWorldLeague') as never,
    (opts.madhab ?? 'Shafi') as never,
    {
      fajr: opts.prefs.prayer_settings?.['الفجر']?.adjust_minutes,
      dhuhr: opts.prefs.prayer_settings?.['الظهر']?.adjust_minutes,
      asr: opts.prefs.prayer_settings?.['العصر']?.adjust_minutes,
      maghrib: opts.prefs.prayer_settings?.['المغرب']?.adjust_minutes,
      isha: opts.prefs.prayer_settings?.['العشاء']?.adjust_minutes,
    },
  );

  // cancel existing
  let cancelled = 0;
  try {
    const pending = await LN.getPending();
    if (pending.notifications.length) {
      await LN.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
      cancelled = pending.notifications.length;
    }
  } catch { /* ignore */ }

  const notifications: Array<{
    id: number; title: string; body: string; schedule: { at: Date; allowWhileIdle: boolean };
    channelId: string; sound?: string; smallIcon?: string;
  }> = [];

  for (const item of schedule) {
    const prayerName = (item.prayer === 'Fajr' ? 'الفجر' : item.prayer === 'Dhuhr' ? 'الظهر' : item.prayer === 'Asr' ? 'العصر' : item.prayer === 'Maghrib' ? 'المغرب' : 'العشاء') as PrayerName;
    const setting = opts.prefs.prayer_settings?.[prayerName];
    if (!setting?.enabled) continue;
    const adhanType = setting.adhan_type ?? 'full';
    if (adhanType === 'silent') continue;
    const channelId = ADHAN_CHANNEL_ID;
    const title = `حان وقت صلاة ${prayerNameAr(item.prayer)}`;
    const body = `وقت ${prayerNameAr(item.prayer)}: ${item.hhmm}`;
    const id = prayerId(item.date, item.prayer);
    notifications.push({
      id,
      title,
      body,
      schedule: { at: item.at, allowWhileIdle: true },
      channelId,
    });
    // remind before
    const before = setting.remind_before_minutes ?? 0;
    if (before > 0) {
      notifications.push({
        id: prayerId(item.date, item.prayer + '-before'),
        title: `تذكير: ${prayerNameAr(item.prayer)} بعد ${before} دقيقة`,
        body: `استعد للصلاة.`,
        schedule: { at: new Date(item.at.getTime() - before * 60000), allowWhileIdle: true },
        channelId: GENERAL_CHANNEL_ID,
      });
    }
  }

  // Android max ~500 pending; keep under 400 to be safe
  const trimmed = notifications.slice(0, 400);

  let warning: string | undefined;
  try {
    const res = await LN.schedule({ notifications: trimmed as never });
    if (res.warning) warning = res.warning.message;
  } catch (e) {
    warning = e instanceof Error ? e.message : 'فشل الجدولة';
  }

  const perms = await checkPermissions();
  return {
    scheduled: trimmed.length,
    cancelled,
    warning,
    permission: perms.display as NativeScheduleResult['permission'],
    exactAlarm: perms.exact as NativeScheduleResult['exactAlarm'],
  };
}

export async function cancelAllPrayerNotifications(): Promise<void> {
  const LN = await loadPlugin();
  if (!LN) return;
  try {
    const pending = await LN.getPending();
    if (pending.notifications.length) {
      await LN.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    }
  } catch { /* ignore */ }
}

export function isNativePlatform(): boolean {
  return isNative();
}
