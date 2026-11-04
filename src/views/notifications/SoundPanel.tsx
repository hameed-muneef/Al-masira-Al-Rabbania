// مكتبة الأصوات — معاينة النغمات المدمجة، اختيار الصوت الافتراضي، ورفع ملف صوتي مخصص
// بتحقق من الصيغة والحجم. الرفع النهائي للسحابة عند توفرها، والتخزين المحلي احتياطيًا.

import {useEffect, useRef, useState} from 'react';
import {Play, Square, Upload} from 'lucide-react';
import {authClient} from '../../auth';
import {BUILTIN_SOUNDS, previewSound, type SoundOption} from '../../notifications/builtin-sounds';
import {playAudio, stopAudio} from '../../notifications/audio';
import {listAudioResources, uploadAudioResource} from '../../notifications/service';
import type {AudioResource, NotificationChannel} from '../../notifications/types';

const ALLOWED_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/aac'];
const MAX_SIZE = 10 * 1024 * 1024;
const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  in_app: 'داخل التطبيق',
  system: 'إشعار النظام',
  both: 'داخل التطبيق + النظام',
};

export function channelLabel(channel: NotificationChannel): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

// تسجيلات الأذان والنغمات التي يديرها المدير؛ تُحمَّل مرة واحدة وتتشاركها الحقول.
let cloudSounds: AudioResource[] = [];
let cloudLoading: Promise<void> | null = null;

export function useCloudSounds(): AudioResource[] {
  const [list, setList] = useState(cloudSounds);
  useEffect(() => {
    if (!authClient) return;
    let active = true;
    cloudLoading ??= listAudioResources()
      .then(rows => {cloudSounds = rows.filter(row => row.kind === 'adhan' || row.kind === 'tone')})
      .catch(() => {cloudLoading = null});
    void cloudLoading.then(() => {if (active) setList(cloudSounds)});
    return () => {active = false};
  }, []);
  return list;
}

export function SoundSelectField({value, onChange, allowNone = true}:
  {value: string | undefined; onChange: (id: string | undefined) => void; allowNone?: boolean}) {
  const cloud = useCloudSounds();
  return (
    <select value={value ?? ''} onChange={event => onChange(event.target.value || undefined)}>
      {allowNone && <option value="">الافتراضي</option>}
      {BUILTIN_SOUNDS.map(sound => <option key={sound.id} value={sound.id}>{sound.title}</option>)}
      {cloud.length > 0 && <optgroup label="الأذان والنغمات المعتمدة">{cloud.map(sound => <option key={sound.id} value={sound.id}>{sound.title}</option>)}</optgroup>}
      {(soundLibraryCustom ?? []).map(sound => <option key={sound.id} value={sound.id}>{sound.title} (مرفوع)</option>)}
    </select>
  );
}

// مكتبة الأصوات المرفوعة التي جرى تحميلها لهذه الجلسة — مُبسّطة ومشتركة بين الحقول
let soundLibraryCustom: AudioResource[] = [];

export default function SoundPanel({notify}: {notify: (message: string) => void}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cloud = useCloudSounds();
  const stop = () => {
    stopAudio();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlaying(null);
  };

  const play = (sound: SoundOption) => {
    stop();
    if (sound.kind === 'silent') {
      setMessage('هذا خيار صامت — لا يُصدر أي صوت.');
      return;
    }
    if (sound.url) playAudio(sound.url); else previewSound(sound);
    setPlaying(sound.id);
    setMessage('');
    window.setTimeout(() => setPlaying(null), 2500);
  };

  const upload = async (file: File) => {
    // التحقق من جهة العميل كحرس أول؛ الخادم يعيد التحقق عند توفر الرفع السحابي
    if (!ALLOWED_TYPES.includes(file.type)) {
      setMessage('صيغة الصوت غير مدعومة. الاستخدام: MP3 أو WAV أو OGG أو M4A.');
      return;
    }
    if (file.size > MAX_SIZE) {
      setMessage('حجم الصوت أكبر من 10 ميغابايت.');
      return;
    }
    setBusy(true);
    setMessage('');
    const title = (file.name.replace(/\.[^.]+$/, '') || 'صوت مخصص').slice(0, 60);
    try {
      if (authClient) {
        const stored = await uploadAudioResource(file, title);
        soundLibraryCustom = [...soundLibraryCustom.filter(item => item.id !== stored.id), stored];
        setMessage(`رُفع «${stored.title}» إلى حسابك.`);
        notify('رُفع الصوت بنجاح');
      } else {
        soundLibraryCustom = [...soundLibraryCustom, {
          id: `custom:${Date.now()}`,
          title,
          kind: 'custom',
          url: URL.createObjectURL(file),
          is_default: false,
          is_uploaded: true,
          created_at: new Date().toISOString(),
        }];
        setMessage(`عُرض «${title}» محليًا للمعاينة. سيرفع الخادم الصوت إلى حسابك عند توفر الخدمة السحابية.`);
      }
    } catch (error) {
      setMessage(`تعذر رفع الصوت: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notif-sound-panel">
      <ul className="notif-sound-list">
        {BUILTIN_SOUNDS.map(sound => (
          <li key={sound.id}>
            <div className="notif-sound-main">
              <strong>{sound.title}</strong>
              <small>{sound.description}</small>
            </div>
            {sound.kind === 'silent'
              ? <span className="muted small">—</span>
              : <button type="button" className="soft-btn notif-play" onClick={() => play(sound)} aria-label={`معاينة ${sound.title}`}>
                  {playing === sound.id ? <Square size={15}/> : <Play size={15}/>}
                </button>}
          </li>
        ))}
        {cloud.map(sound => (
          <li key={sound.id}>
            <div className="notif-sound-main">
              <strong>{sound.title}</strong>
              <small>{sound.kind === 'adhan' ? 'أذان' : 'نغمة'}</small>
            </div>
            <button type="button" className="soft-btn notif-play" onClick={() => play(sound)} aria-label={`معاينة ${sound.title}`}>
              {playing === sound.id ? <Square size={15}/> : <Play size={15}/>}
            </button>
          </li>
        ))}
        {soundLibraryCustom.map(sound => (
          <li key={sound.id}>
            <div className="notif-sound-main">
              <strong>{sound.title}</strong>
              <small>صوت مرفوع من المستخدم</small>
            </div>
            <button type="button" className="soft-btn notif-play" onClick={() => play(sound)} aria-label={`معاينة ${sound.title}`}>
              {playing === sound.id ? <Square size={15}/> : <Play size={15}/>}
            </button>
          </li>
        ))}
      </ul>
      <label className="notif-upload">
        <Upload size={16}/> رفع ملف صوتي مخصص (حتى 10 ميغابايت)
        <input type="file" accept="audio/*" disabled={busy} onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}/>
      </label>
      {message && <p role="status" className="muted small">{message}</p>}
    </div>
  );
}
