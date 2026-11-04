import {useMemo,useState} from 'react';
import {CalendarClock, CheckCircle2, RotateCcw} from 'lucide-react';
import type {QuranAsset, QuranLearningState} from '../../quran/types';
import {applyReview, dateKey, duePassages, memorizationStats, WEEK_DAYS} from '../../quran/learning';
import {referenceLabel, toArabicNumber} from '../../quran/content';
import {uid} from '../../id';
import {EmptyNote} from './ui';
import PassagePractice from './PassagePractice';

type Props = {
  asset: QuranAsset;
  state: QuranLearningState;
  onState: (next: QuranLearningState) => void;
  notify: (text: string) => void;
};

export default function QuranRevision({asset, state, onState, notify}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const passes = useMemo(() => state.passages.filter(passage => passage.contentType === 'quran' && (passage.reviewCount > 0 || passage.state !== 'new')), [state.passages]);
  const due = duePassages(passes);
  const upcoming = passes.filter(passage => passage.state !== 'mastered' && passage.dueDate && passage.dueDate > dateKey())
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')).slice(0, 20);
  const stats = memorizationStats(passes, state.revisionEvents);
  const active = passes.find(passage => passage.id === selected) ?? due[0];

  const rate = (quality: number) => {
    if (!active) return;
    const result = applyReview(active, quality);
    onState({
      ...state,
      passages: state.passages.map(passage => passage.id === active.id ? result.passage : passage),
      revisionEvents: [{...result.event, id: uid()}, ...state.revisionEvents].slice(0, 1000),
      updatedAt: new Date().toISOString()
    });
    setSelected(null);
    notify(result.event.outcome === 'failed'
      ? 'أُعيد المقطع إلى قائمة المراجعة اليوم.'
      : `نجح الاسترجاع؛ المراجعة القادمة بعد ${toArabicNumber(result.passage.intervalDays)} يومًا.`);
  };

  const markAgain = (passageId: string) => {
    onState({
      ...state,
      passages: state.passages.map(passage => passage.id === passageId ? {...passage, state: 'needs_revision', dueDate: dateKey(), updatedAt: new Date().toISOString()} : passage),
      updatedAt: new Date().toISOString()
    });
    notify('أُعيد المقطع إلى قائمة المراجعة.');
  };

  return <div className="quran-revision">
    <div className="quran-section-head">
      <div><span className="eyebrow">مراجعة القرآن</span><h2>المراجعة المتباعدة</h2><p>فور الحفظ، ثم بعد يوم و٣ و٧ و١٤ و٣٠ يومًا. تعثر المقطع يعيده إلى قائمة اليوم، والنجاح المتتابع وحده يجعله راسخًا.</p></div>
    </div>

    <div className="quran-stat-grid">
      <div className="panel"><span>مستحق اليوم</span><strong>{toArabicNumber(due.length)}</strong><small>مقطعًا</small></div>
      <div className="panel"><span>آيات محفوظة</span><strong>{toArabicNumber(stats.memorizedVerses)}</strong><small>آية</small></div>
      <div className="panel"><span>راسخ</span><strong>{toArabicNumber(stats.masteredVerses)}</strong><small>آية</small></div>
      <div className="panel"><span>نسبة نجاح المراجعة</span><strong>{toArabicNumber(stats.successRate)}٪</strong><small>{toArabicNumber(stats.totalEvents)} محاولة</small></div>
    </div>

    <div className="quran-two-col">
      <section className="panel">
        <h3><CalendarClock size={18}/> قائمة اليوم</h3>
        {due.length === 0 ? <EmptyNote>لا مقاطع مستحقة اليوم. تابع خطة الحفظ أو راجع ما هو قادم أدناه.</EmptyNote> : <ul className="quran-passage-list">
          {due.map(passage => <li key={passage.id}>
            <button className={active?.id === passage.id ? 'active' : ''} onClick={() => setSelected(passage.id)}>
              <span><strong>{passage.surah != null && passage.ayahStart != null ? referenceLabel(asset, passage.surah, passage.ayahStart, passage.ayahEnd) : 'مقطع'}</strong>
                <small>{passage.state === 'needs_revision' ? 'يحتاج مراجعة' : passage.state === 'learning' ? 'مراجعة أولى' : 'مراجعة'} · تكرر {toArabicNumber(passage.reviewCount)} مرة · تعثر {toArabicNumber(passage.lapses)}</small></span>
            </button>
            <button className="icon-btn" aria-label="تأجيل إلى اليوم" onClick={() => markAgain(passage.id)}><RotateCcw size={15}/></button>
          </li>)}
        </ul>}
      </section>

      <section className="panel">
        <h3>القادم</h3>
        {upcoming.length === 0 ? <EmptyNote>لا مراجعات مجدولة قادمة.</EmptyNote> : <ul className="quran-mini-list">
          {upcoming.map(passage => <li key={passage.id}>
            <span>{passage.surah != null && passage.ayahStart != null ? referenceLabel(asset, passage.surah, passage.ayahStart, passage.ayahEnd) : 'مقطع'}</span>
            <small>{passage.dueDate} · {WEEK_DAYS[new Date(`${passage.dueDate}T12:00:00`).getDay()]}</small>
          </li>)}
        </ul>}
      </section>
    </div>

    {active ? <section className="panel">
      <PassagePractice asset={asset} passage={active} notify={notify} onRate={rate}/>
    </section> : <section className="panel quran-revision-empty">
      <CheckCircle2 size={26}/><p>أنشئ خطة حفظ وأتمّ مقطعًا ليظهر هنا في موعده.</p>
    </section>}
  </div>;
}
