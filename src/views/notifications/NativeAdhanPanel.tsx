// src/views/notifications/NativeAdhanPanel.tsx
import { useEffect, useState } from 'react';
import { loadPrefs } from '../../notifications/prefs-store';
import { sanitizePrayerLocation, type PrayerLocation } from '../../prayer-location';
import { openAppSettings as openNativeAppSettings, openBatterySettings as openNativeBatterySettings } from '../../lib/settings-opener';
import {
  ensureChannels,
  checkPermissions,
  requestPermissions,
  schedulePrayerNotifications,
  cancelAllPrayerNotifications,
  isNativePlatform,
  ADHAN_CHANNEL_ID,
  GENERAL_CHANNEL_ID,
} from '../../notifications/native-prayer-scheduler';

interface Props { prayerLocation?: PrayerLocation; onNotify: (m: string) => void; }

export default function NativeAdhanPanel({ prayerLocation, onNotify }: Props) {
  const [perm, setPerm] = useState<{ display: string; exact: string }>({ display: 'prompt', exact: 'unsupported' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>('');
  const [supported] = useState(isNativePlatform());
  const [explainerOpen, setExplainerOpen] = useState(false);

  const refresh = async () => {
    const p = await checkPermissions();
    setPerm(p);
  };

  useEffect(() => { void refresh(); }, []);

  const handleEnable = () => setExplainerOpen(true);

  const confirmEnable = async () => {
    setExplainerOpen(false);
    setBusy(true);
    try {
      await ensureChannels();
      const p = await requestPermissions();
      setPerm(p);
      if (p.display !== 'granted') {
        onNotify('لم يُمنح إذن الإشعارات. يمكنك تفعيله من إعدادات النظام.');
        return;
      }
      const loc = sanitizePrayerLocation(prayerLocation);
      if (!loc) {
        onNotify('اختر موقعك (المدينة) أولاً.');
        return;
      }
      const { prefs } = await loadPrefs();
      const r = await schedulePrayerNotifications({ location: loc, prefs, days: 10 });
      setResult(`تم جدولة ${r.scheduled} منبه (${r.cancelled} ملغى).${r.warning ? ' تحذير: ' + r.warning : ''}`);
      onNotify('تم تفعيل تنبيهات الأذان على مستوى النظام.');
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'فشل تفعيل التنبيهات.');
    } finally {
      setBusy(false);
    }
  };

  const openAppSettings = async () => {
    const r = await openNativeAppSettings();
    if (r.opened) onNotify('تم فتح إعدادات التطبيق.');
    else if (r.error === 'not-native') onNotify('متاح في تطبيق Android فقط. يدويا: Settings -> Apps -> Al-Rabbaniyyun -> Permissions.');
    else onNotify('تعذر فتح الإعدادات. يدويا: Settings -> Apps -> Al-Rabbaniyyun -> Permissions.');
  };

  const openBatterySettings = async () => {
    const r = await openNativeBatterySettings();
    if (r.opened) onNotify('تم فتح إعدادات توفير البطارية.');
    else if (r.error === 'not-native') onNotify('متاح في تطبيق Android فقط. يدويا: Settings -> Battery -> Battery optimization -> Al-Rabbaniyyun -> Don\'t optimize.');
    else onNotify('تعذر فتح إعدادات البطارية. يدويا: Settings -> Battery -> Battery optimization -> Al-Rabbaniyyun -> Don\'t optimize.');
  };

  const handleReschedule = async () => {
    setBusy(true);
    try {
      const loc = sanitizePrayerLocation(prayerLocation);
      if (!loc) { onNotify('اختر موقعك أولاً.'); return; }
      const { prefs } = await loadPrefs();
      const r = await schedulePrayerNotifications({ location: loc, prefs, days: 10 });
      setResult(`إعادة جدولة: ${r.scheduled} منبه.`);
      onNotify('تمت إعادة جدولة الأذان.');
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'فشل.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      await cancelAllPrayerNotifications();
      setResult('تم إلغاء جميع منبهات الأذان.');
      onNotify('تم إلغاء المنبهات.');
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return (
      <div className="notif-prayer-panel">
        <h3>تنبيهات الأذان (نظام)</h3>
        <p className="muted small">
          تنبيهات الأذان على مستوى النظام (عند إغلاق التطبيق) متاحة في تطبيق Android (Capacitor) فقط.
          في نسخة الويب، الأذان يعمل داخل التطبيق (إن كان مفتوحًا).
        </p>
      </div>
    );
  }

  return (
    <>
      {explainerOpen && (
        <div className="qibla-banner info" role="dialog" aria-modal="true" style={{ marginBottom: 12 }}>
          <strong>قبل تفعيل تنبيهات الأذان</strong>
          <p className="muted small" style={{ margin: '6px 0' }}>
            سيطلب التطبيق إذن الإشعارات (Android 13+) وإذن المنبهات الدقيقة (Android 12+) لجدولة الأذان في وقتها.
            الأذان يعمل محليًا (بدون إنترنت). يمكنك إيقاف أي صلاة من الإعدادات.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="primary" disabled={busy} onClick={() => void confirmEnable()}>متابعة وطلب الإذن</button>
            <button className="soft-btn" onClick={() => setExplainerOpen(false)}>إلغاء</button>
          </div>
        </div>
      )}
      <div className="notif-prayer-panel">
      <h3>تنبيهات الأذان (نظام Android)</h3>
      <p className="muted small">
        جدولة 10 أيام من مواقيت الصلاة كمنبهات نظام (تعمل حتى عند إغلاق التطبيق).
        أعد الجدولة عند كل فتح للتطبيق أو تغيير الإعدادات.
      </p>

      <div className="form-grid">
        <div>
          <strong>حالة الإذن (display):</strong> {perm.display}
        </div>
        <div>
          <strong>المنبهات الدقيقة (exact alarm):</strong> {perm.exact}
        </div>
        <div>
          <strong>قناة الأذان:</strong> {ADHAN_CHANNEL_ID} (صوت: res/raw/adhan.mp3)
        </div>
        <div>
          <strong>قناة عامة:</strong> {GENERAL_CHANNEL_ID}
        </div>
      </div>

      {perm.display !== 'granted' && (
        <div className="qibla-banner warn" role="alert">
          لم يُمنح إذن الإشعارات. اضغط «تفعيل» لطلب الإذن، أو افتح إعدادات النظام.
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="soft-btn" onClick={openAppSettings}>فتح إعدادات التطبيق</button>
            <button className="soft-btn" onClick={openBatterySettings}>إعدادات توفير البطارية</button>
          </div>
        </div>
      )}
      {perm.exact !== 'granted' && perm.exact !== 'unsupported' && (
        <div className="qibla-banner warn" role="alert">
          منبهات الأذان الدقيقة (exact alarm) غير مفعلة. الأذان قد يتأخر (inexact). افتح إعدادات النظام → Alarms &amp; reminders → السماح.
        </div>
      )}

      <div className="notif-form-actions">
        <button className="primary" disabled={busy} onClick={() => void handleEnable()}>
          {busy ? 'جارٍ…' : 'تفعيل تنبيهات الأذان'}
        </button>
        <button className="soft-btn" disabled={busy} onClick={() => void handleReschedule()}>
          إعادة جدولة
        </button>
        <button className="soft-btn" disabled={busy} onClick={() => void handleCancel()}>
          إلغاء الكل
        </button>
      </div>

      {result && <p className="muted small">{result}</p>}

      <details className="qibla-steps" style={{ marginTop: 8 }}>
        <summary><strong>تشخيص + تعليمات أجهزة OEM</strong></summary>
        <ul style={{ paddingInlineStart: 20, fontSize: 13 }}>
          <li>Android 13+: صلاحية POST_NOTIFICATIONS (تُطلب وقت التشغيل).</li>
          <li>Android 12+: صلاحية SCHEDULE_EXACT_ALARM (exact alarm) — توجيه المستخدم لإعدادات النظام.</li>
          <li>استثناء توفير البطارية: Settings → Battery → Battery optimization → Al-Rabbaniyyun → Don't optimize.</li>
          <li>Xiaomi/Huawei/Oppo: فعّل "التشغيل التلقائي" (Auto-start) و"التشغيل في الخلفية" (Background activity) و"عرض الإشعارات على شاشة القفل".</li>
          <li>إعادة تشغيل الجهاز: منبهات exact alarm تُستعاد تلقائيًا (Android  preserves scheduled alarms across reboot for exact alarms). أعد فتح التطبيق لتثبيت جدولة 10 أيام.</li>
          <li>تغيير المنطقة الزمنية/الموقع/التوقيت الصيفي: أعد فتح التطبيق (إعادة جدولة تلقائية).</li>
        </ul>
      </details>

      <details className="qibla-steps" style={{ marginTop: 8 }}>
        <summary><strong>كيفية تغيير صوت الأذان لاحقًا</strong></summary>
        <ol style={{ paddingInlineStart: 20, fontSize: 13 }}>
          <li>صوت الأذان: `android/app/src/main/res/raw/adhan.mp3` (موجود — MP3، 16000 Hz، mono، ~158.8 s). لا يوجد حد 30 ثانية في Android (هذا حد iOS/APNs). مع ذلك، لأذان كامل (دقائق) في الخلفية/الشاشة مغلقة، يُوصى بـ Foreground Service (MediaPlayer) (راجع docs/play-console-notes.md §7).</li>
          <li> channels created once; to change sound, create a NEW channel id (e.g. `al-rabbani-adhan-v2`) with new `sound`, and schedule notifications with the new `channelId`. Android 8+ locks channel sound after creation.</li>
          <li>أو استخدم `LocalNotifications.createChannel` مع id جديد ثم `schedule` مع `channelId` الجديد.</li>
        </ol>
      </details>
    </div>
    </>
  );
}
