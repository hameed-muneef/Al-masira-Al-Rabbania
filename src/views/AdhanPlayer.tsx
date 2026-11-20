// مشغّل أذان: اختيار صوت الأذان (محلي أو خارجي) وتشغيله/إيقافه.
import {useEffect, useRef, useState} from 'react';
import {Play, Square, Volume2, Trash2} from 'lucide-react';
import {saveCustomSound, loadCustomSound, deleteCustomSound, customSoundUrl} from '../sounds/custom-store';

// re-export ADHAN_SOUNDS locally
const SOUNDS: AdhanSound[] = [
  {id: 'ahmad', name: 'أحمد العمادي', url: encodeURI('/sounds/adhan/احمد العمادي.mp3')},
  {id: 'madinah', name: 'أذان الحرم المدني', url: encodeURI('/sounds/adhan/اذان الحرم المدني.mp3')},
  {id: 'madinah2', name: 'أذان الحرم المدني 2', url: encodeURI('/sounds/adhan/اذان الحرم المدني 2.mp3')},
  {id: 'mohammed', name: 'أذان محمد رمضان (الحرم)', url: encodeURI('/sounds/adhan/اذان محمد رمضان الحرم.mp3')},
  {id: 'almulla', name: 'الملا', url: encodeURI('/sounds/adhan/الملا.mp3')},
  {id: 'eid', name: 'تكبيرات العيد', url: encodeURI('/sounds/adhan/تكبيرات العيد.mp3')},
  {id: 'hamad', name: 'حمد الدغريري', url: encodeURI('/sounds/adhan/حمد الدغريري.mp3')},
  {id: 'external', name: 'أذان خارجي (ملف من جهازك)', url: ''},
];

export type AdhanSound = {id: string; name: string; url: string};

const STORAGE_KEY = 'rabbani-adhan-id';

export default function AdhanPlayer({notify}: {notify: (text: string) => void}) {
  const [selected, setSelected] = useState<string>(() => {
    try { const v = localStorage.getItem(STORAGE_KEY); return SOUNDS.some(s => s.id === v) ? v! : SOUNDS[0].id; } catch { return SOUNDS[0].id; }
  });
  const [external, setExternal] = useState<{name: string; url: string} | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pickerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, selected); } catch { /* ignore */ }
  }, [selected]);

  useEffect(() => {
    if (selected !== 'external') return;
    (async () => {
      const rec = await loadCustomSound('adhan');
      if (rec) {
        const url = customSoundUrl(rec);
        setExternal({name: rec.name, url});
      } else {
        setExternal(null);
      }
    })();
  }, [selected]);

  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

  const sound = SOUNDS.find(s => s.id === selected) ?? SOUNDS[0];
  const playUrl = selected === 'external' ? (external?.url ?? null) : sound.url;

  const toggle = () => {
    if (playing) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlaying(false);
      return;
    }
    if (!playUrl) {
      notify('اختر ملف أذان خارجي أولًا.');
      return;
    }
    const audio = new Audio(playUrl);
    audioRef.current = audio;
    setPlaying(true);
    audio.addEventListener('ended', () => { setPlaying(false); audioRef.current = null; }, {once: true});
    audio.addEventListener('error', () => { setPlaying(false); audioRef.current = null; notify('تعذر تشغيل الأذان.'); }, {once: true});
    audio.play().catch(() => { setPlaying(false); audioRef.current = null; notify('تعذر تشغيل الأذان.'); });
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    try {
      await saveCustomSound('adhan', file);
      const rec = await loadCustomSound('adhan');
      if (rec) {
        const url = customSoundUrl(rec);
        setExternal({name: rec.name, url});
        notify('تم حفظ الأذان الخارجي.');
      }
    } catch {
      notify('تعذر حفظ الملف.');
    }
  };

  const removeExternal = async () => {
    await deleteCustomSound('adhan');
    setExternal(null);
    if (selected === 'external') setSelected(SOUNDS[0].id);
    notify('تم حذف الأذان الخارجي.');
  };

  return (
    <section className="panel adhan-player" dir="rtl">
      <h3><Volume2 size={18}/> أذان الصلاة</h3>
      <p className="muted">اختر صوت الأذان (محلي أو ملف من جهازك) وشغّله.</p>
      <div className="adhan-row">
        <select value={selected} onChange={event => setSelected(event.target.value)} aria-label="صوت الأذان" style={{flex: 1, minWidth: 0}}>
          {SOUNDS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button type="button" className={playing ? 'soft-btn selected' : 'primary'} onClick={toggle} aria-pressed={playing}>
          {playing ? <Square size={16}/> : <Play size={16}/>} {playing ? 'إيقاف' : 'تشغيل الأذان'}
        </button>
      </div>
      {selected === 'external' && (
        <div className="adhan-external">
          {external ? (
            <div className="adhan-ext-row">
              <span className="muted small">الملف: {external.name}</span>
              <button type="button" className="soft-btn" onClick={removeExternal} aria-label="حذف الأذان الخارجي"><Trash2 size={15}/> حذف</button>
            </div>
          ) : (
            <label className="adhan-file-label">
              اختر ملف صوتي (MP3/OGG/WAV)
              <input ref={pickerRef} type="file" accept="audio/*" onChange={event => void onFile(event.target.files?.[0] ?? null)} />
            </label>
          )}
        </div>
      )}
    </section>
  );
}
