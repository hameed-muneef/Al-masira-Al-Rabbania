// تلاوة على مستوى الآية (per-ayah) من Quran.com API v4
// يوفر روابط صوتية لكل آية على حدة (بدقة تلاوة الآية).
// يُستخدم إلى جانب تلاوة MP3Quran.net (على مستوى السورة).

export type AyahAudioResult = {verseKey: string; url: string};

const BASE_AUDIO = 'https://verses.quran.com/';
const CACHE = new Map<string, string>();

// recitation_id → 7 = Mishary Rashid Alafasy (default)
export const DEFAULT_RECITATION_ID = 7;

export async function fetchAyahAudioUrl(recitationId: number, surah: number, ayah: number): Promise<string | null> {
  const key = `${recitationId}:${surah}:${ayah}`;
  if (CACHE.has(key)) return CACHE.get(key)!;
  try {
    const res = await fetch(`https://api.quran.com/api/v4/recitations/${recitationId}/by_ayah/${surah}:${ayah}`);
    if (!res.ok) return null;
    const json = await res.json();
    const url = json?.audio_files?.[0]?.url;
    if (url) {
      const full = url.startsWith('http') ? url : `${BASE_AUDIO}${url}`;
      CACHE.set(key, full);
      return full;
    }
    return null;
  } catch {
    return null;
  }
}

// Fetch a batch of ayahs for a surah (for sequential playback)
export async function fetchSurahAyahAudioUrls(recitationId: number, surah: number, _ayahs: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  // Quran.com API supports fetching all ayahs of a surah at once
  try {
    const res = await fetch(`https://api.quran.com/api/v4/recitations/${recitationId}/by_chapter/${surah}`);
    if (!res.ok) return result;
    const json = await res.json();
    for (const af of json?.audio_files ?? []) {
      const ak = af.verse_key?.split(':')[1];
      if (ak && af.url) {
        result.set(Number(ak), af.url.startsWith('http') ? af.url : `${BASE_AUDIO}${af.url}`);
      }
    }
  } catch { /* ignore */ }
  return result;
}

// Popular reciters available on Quran.com
export const QURAN_COM_RECITERS: {id: number; name: string}[] = [
  {id: 7, name: 'مشاري راشد العفاسي'},
  {id: 1, name: 'عبد الباسط عبد الصمد'},
  {id: 2, name: 'عبد الرحمن السديس'},
  {id: 3, name: 'سعود الشريم'},
  {id: 4, name: 'ماهر المعيقلي'},
  {id: 5, name: 'محمد صديق المنشاوي'},
  {id: 6, name: 'محمود خليل الحصري'},
];
