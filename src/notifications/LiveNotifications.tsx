// محرك الإشعارات الحي: يشغّل المراقب الزمني ويوصل الأحداث المستحقة بصوتها المختار.
// يعمل فقط أثناء فتح التطبيق (قيد المتصفح)، وهو موثق في إعدادات الإشعارات.

import {useEffect, useRef} from 'react';
import usePrayerTimes from '../usePrayerTimes';
import {sanitizePrayerLocation, type PrayerLocation} from '../prayer-location';
import {useDueWatcher, type DueItem} from './engine';
import {loadPrefs, loadReminders} from './prefs-store';
import {listAudioResources} from './service';
import {playAudio} from './audio';
import {playBuiltInTone} from './builtin-sounds';
import {deliverReminder, isBrowserNotificationSupported, recordNotification, showBrowserNotification} from './delivery';
import {soundPlanForPrayer, soundPlanForReminder, type SoundPlan} from './sound-selection';
import {DEFAULT_NOTIFICATION_PREFERENCE, type AudioResource, type NotificationPreference, type Reminder} from './types';
import type {MemorizationPassage} from '../quran/types';

const REFRESH_MS = 60000;
// A single browser tab can briefly have two watcher deliveries during React
// remounts or visibility changes. Keep the audio claim outside the component
// so a remount cannot play the same prayer twice within the same short window.
const recentAudioClaims = new Map<string, number>();
function claimAudio(key: string, now = Date.now()): boolean {
  const previous = recentAudioClaims.get(key);
  if (previous && now - previous < 15_000) return false;
  // Coordinate open tabs as well as remounts in one tab. localStorage is
  // deliberately best-effort: if it is unavailable, the in-memory guard
  // above still prevents the common React remount duplicate.
  try {
    const storageKey = `rabbani-audio-claim:${key}`;
    const stored = Number(window.localStorage.getItem(storageKey) ?? 0);
    if (stored && now - stored < 15_000) return false;
    window.localStorage.setItem(storageKey, String(now));
    const confirmed = Number(window.localStorage.getItem(storageKey) ?? 0);
    if (confirmed !== now) return false;
  } catch {
    // Private browsing or blocked storage: continue with the local guard.
  }
  recentAudioClaims.set(key, now);
  for (const [oldKey, claimedAt] of recentAudioClaims) {
    if (now - claimedAt >= 15_000) recentAudioClaims.delete(oldKey);
  }
  return true;
}

function play(plan: SoundPlan) {
  if (plan.mode === 'tone') playBuiltInTone(plan.id);
  else if (plan.mode === 'file') playAudio(plan.url);
}

type Props = {prayers: Record<string, string>; prayerLocation?: PrayerLocation; passages?: MemorizationPassage[]; onToast: (message: string) => void};

export default function LiveNotifications({prayers, prayerLocation, passages, onToast}: Props) {
  const located = usePrayerTimes(Boolean(prayerLocation), sanitizePrayerLocation(prayerLocation));
  const state = useRef({
    reminders: [] as Reminder[],
    prefs: DEFAULT_NOTIFICATION_PREFERENCE as NotificationPreference,
    library: [] as AudioResource[],
    prayers: {} as Record<string, string>,
    passages: [] as MemorizationPassage[],
    ready: false,
  });
  state.current.prayers = {...prayers, ...located.prayers};
  state.current.passages = passages ?? [];

  useEffect(() => { state.current.passages = passages ?? []; }, [passages]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [prefs, reminders, library] = await Promise.all([
        loadPrefs().catch(() => null),
        loadReminders().catch(() => null),
        listAudioResources().catch(() => null),
      ]);
      if (!active) return;
      if (prefs) state.current.prefs = prefs.prefs;
      if (reminders) state.current.reminders = reminders.reminders;
      if (library) state.current.library = library;
      state.current.ready = true;
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    const onVisible = () => {if (document.visibilityState === 'visible') void refresh()};
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useDueWatcher(
    () => state.current.ready ? {reminders: state.current.reminders, prayers: state.current.prayers, prefs: state.current.prefs, passages: state.current.passages} : null,
    (item: DueItem) => {
      const {prefs, library} = state.current;
      if (item.kind === 'reminder') {
        play(soundPlanForReminder(item.reminder.sound_id, prefs, library));
        void deliverReminder(item.reminder, prefs.reminder_settings?.default_channel ?? 'both');
        onToast(item.reminder.title);
        return;
      }
      if (item.kind === 'review') {
        const passage = item.passage;
        const surahName = passage.surah ? `سورة ${passage.surah}` : 'مقطع';
        const ayahRange = passage.ayahStart && passage.ayahEnd ? ` (آية ${passage.ayahStart}–${passage.ayahEnd})` : '';
        const title = `مراجعة حفظ — ${surahName}${ayahRange}`;
        const body = 'حان وقت مراجعة مقطعك المحفوظ. «وَذَكِّرْ فَإِنَّ الذِّكْرَىٰ تَنفَعُ الْمُؤْمِنِينَ»';
        play(soundPlanForReminder(prefs.reminder_settings?.default_sound_id, prefs, library));
        if ((prefs.reminder_settings?.default_channel === 'system' || prefs.reminder_settings?.default_channel === 'both') && isBrowserNotificationSupported()) {
          showBrowserNotification(title, {body, tag: item.key, requireInteraction: true});
        }
        if (prefs.reminder_settings?.default_channel === 'in_app' || prefs.reminder_settings?.default_channel === 'both') {
          onToast(title);
          void recordNotification('reminder', title, body, 'settings');
        }
        return;
      }
      const {event} = item;
      if (!claimAudio(item.key)) return;
      const channel = prefs.prayer_settings?.[event.prayer]?.channel ?? 'both';
      play(soundPlanForPrayer(event, prefs, library));
      if ((channel === 'system' || channel === 'both') && isBrowserNotificationSupported()) {
        showBrowserNotification(event.title, {body: event.body, tag: event.key, requireInteraction: event.kind === 'at'});
      }
      if (channel === 'in_app' || channel === 'both') {
        onToast(event.title);
        void recordNotification('prayer', event.title, event.body, 'settings');
      }
    },
  );
  return null;
}
