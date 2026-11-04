// اختيار الصوت المناسب لكل حدث (نطاق عمل خالص قابل للاختبار بلا تشغيل فعلي)

import type {AudioResource, NotificationPreference} from './types';
import type {PrayerEvent} from './prayer-planner';

export const SILENT_SOUND = 'builtin:silent';
const DEFAULT_AT_SOUND = 'builtin:chime';
const DEFAULT_REMINDER_SOUND = 'builtin:soft';

export type SoundPlan =
  | {mode: 'none'}
  | {mode: 'tone'; id: string}
  | {mode: 'file'; id: string; url: string};

/** يحوّل معرّف الصوت المختار إلى خطة تشغيل؛ المعرّف المجهول أو المفقود يعود إلى نغمة افتراضية بدل الصمت */
export function planSound(soundId: string | undefined, library: readonly Pick<AudioResource, 'id' | 'url'>[], fallbackTone: string): SoundPlan {
  const id = soundId || fallbackTone;
  if (id === SILENT_SOUND) return {mode: 'none'};
  if (id.startsWith('builtin:')) return {mode: 'tone', id};
  const found = library.find(item => item.id === id);
  if (found?.url && /^https:\/\//i.test(found.url)) return {mode: 'file', id, url: found.url};
  return {mode: 'tone', id: fallbackTone};
}

export function soundPlanForPrayer(event: PrayerEvent, prefs: NotificationPreference, library: readonly Pick<AudioResource, 'id' | 'url'>[]): SoundPlan {
  const settings = prefs.prayer_settings?.[event.prayer];
  if (!settings || settings.adhan_type === 'silent') return {mode: 'none'};
  return planSound(settings.sound_id, library, event.kind === 'at' ? DEFAULT_AT_SOUND : DEFAULT_REMINDER_SOUND);
}

export function soundPlanForReminder(soundId: string | undefined, prefs: NotificationPreference, library: readonly Pick<AudioResource, 'id' | 'url'>[]): SoundPlan {
  return planSound(soundId || prefs.reminder_settings?.default_sound_id, library, DEFAULT_REMINDER_SOUND);
}
