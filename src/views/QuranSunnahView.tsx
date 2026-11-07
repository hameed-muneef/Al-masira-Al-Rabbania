import {useEffect,useRef,useState} from 'react';
import {
  BookOpen, Brain, RotateCcw, Library, ScrollText, CalendarClock, TrendingUp,
  ShieldCheck, WifiOff, Flower2
} from 'lucide-react';
import '../quran.css';
import type {QuranAsset, QuranLearningState} from '../quran/types';
import type {Task} from '../app-state';
import {loadQuran} from '../quran/content';
import QuranReader from './quran/QuranReader';
import QuranMemorization from './quran/QuranMemorization';
import QuranRevision from './quran/QuranRevision';
import HadithLibrary from './quran/HadithLibrary';
import QuranRoutine from './quran/QuranRoutine';
import QuranProgress from './quran/QuranProgress';
import QuranJourney from './quran/QuranJourney';
import AzkarLibrary from './AzkarLibrary';
import {EmptyNote} from './quran/ui';

export type QuranSection = 'mushaf' | 'hifz' | 'revision' | 'bukhari' | 'muslim' | 'sunnah' | 'routine' | 'progress' | 'azkar';

type Props = {
  state: QuranLearningState;
  onState: (next: QuranLearningState) => void;
  tasks: Task[];
  onTasks: (tasks: Task[]) => void;
  notify: (text: string) => void;
  onOpenTasks: () => void;
  initialSection?: QuranSection;
};

const SECTIONS: {id: QuranSection; title: string; description: string; icon: typeof BookOpen}[] = [
  {id: 'mushaf', title: 'المصحف الشريف', description: 'قراءة بالرسم العثماني، بحث، علامات، ملاحظات وسجل قراءة.', icon: BookOpen},
  {id: 'hifz', title: 'حفظ القرآن', description: 'خطط مرنة وتمارين إخفاء وإكمال وترتيب واسترجاع.', icon: Brain},
  {id: 'revision', title: 'مراجعة القرآن', description: 'مراجعة متباعدة تحفظ ما حفظته وتعيد المتعثر.', icon: RotateCcw},
  {id: 'bukhari', title: 'صحيح البخاري', description: '', icon: Library},
  {id: 'muslim', title: 'صحيح مسلم', description: '', icon: Library},
  {id: 'sunnah', title: 'حفظ السنة', description: 'خطط حفظ الحديث بعد اعتماد النص الكامل المرخص.', icon: ScrollText},
  {id: 'routine', title: 'وردي اليومي', description: 'جدولة القرآن والسنة داخل مهام اليوم نفسها.', icon: CalendarClock},
  {id: 'progress', title: 'سجل الإنجاز', description: 'قراءة وحفظ وإتقان وانتظام وتأملات خاصة.', icon: TrendingUp},
  {id: 'azkar', title: 'أذكار', description: 'حصن Muslim — أذكار الصباح والمساء وسائر الأوقات، مع عداد تكرار وصوت.', icon: Flower2}
];

export default function QuranSunnahView({state, onState, tasks, onTasks, notify, onOpenTasks, initialSection}: Props) {
  const [section, setSection] = useState<QuranSection>(initialSection ?? 'mushaf');
  const sectionHeaderRef = useRef<HTMLDivElement>(null);
  const [asset, setAsset] = useState<QuranAsset | null>(null);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine);

  const handleSectionChange = (id: QuranSection) => {
    setSection(id);
    // تمرير إلى محتوى القسم بعد تحديث DOM
    setTimeout(() => {
      if (sectionHeaderRef.current) {
        const top = sectionHeaderRef.current.offsetTop - 80;
        document.documentElement.scroll(0, top);
      }
    }, 1000);
  };

  useEffect(() => {
    let active = true;
    loadQuran().then(value => { if (active) setAsset(value); }).catch(() => { if (active) setError('تعذر تحميل أصل المصحف المعتمد. تحقق من الاتصال ثم أعد المحاولة؛ لا يُعرض نص بديل.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);

  const current = SECTIONS.find(item => item.id === section) ?? SECTIONS[0];

  return <div className="quran-page">
    <div className="page-intro quran-intro">
      <span className="eyebrow">القرآن والسنة</span>
      <h1>القرآن والسنة</h1>
      <p>اقرأ، واحفظ، وراجع، وتأمل، وطبّق. محتوى مصدري ثابت، وتقدمك محفوظ، وقراءتك لا تُخلط بإتقانك.</p>
      <div className="quran-trust-row">
        <span><ShieldCheck size={15}/> نص عثماني من مجمع الملك فهد · رواية حفص</span>
        <span className={online ? '' : 'offline'}>{online ? 'متاح دون اتصال بعد أول تحميل' : <><WifiOff size={14}/> دون اتصال — النص المحفوظ فقط</>}</span>
      </div>
    </div>

    <QuranJourney asset={asset} state={state} onOpen={handleSectionChange}/>

    <nav className="quran-section-grid" aria-label="أقسام القرآن والسنة">
      {SECTIONS.map(item => {
        const Icon = item.icon;
        return <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => handleSectionChange(item.id)}>
          <span className="quran-section-icon"><Icon size={22}/></span>
          <strong>{item.title}</strong>
          <small>{item.description}</small>
        </button>;
      })}
    </nav>

    <div className="quran-section-header" ref={sectionHeaderRef}>
      <h2>{current.title}</h2>
      {current.description && <p>{current.description}</p>}
    </div>

    {error ? <section className="panel quran-error" role="alert"><h3>تعذر فتح المصحف</h3><p>{error}</p><button className="soft-btn" onClick={() => { setError(''); loadQuran().then(setAsset).catch(() => setError('تعذر تحميل أصل المصحف المعتمد مرة أخرى.')); }}>إعادة المحاولة</button></section>
      : !asset ? <section className="panel"><EmptyNote>جارٍ تحميل النص العثماني والبيانات الوصفية…</EmptyNote></section>
      : <>
        {section === 'mushaf' && <QuranReader asset={asset} state={state} onState={onState} notify={notify}/>}
        {section === 'hifz' && <QuranMemorization asset={asset} state={state} onState={onState} notify={notify}/>}
        {section === 'revision' && <QuranRevision asset={asset} state={state} onState={onState} notify={notify}/>}
        {section === 'bukhari' && <HadithLibrary collectionKey="bukhari" mode="library" state={state} onState={onState} notify={notify}/>}
        {section === 'muslim' && <HadithLibrary collectionKey="muslim" mode="library" state={state} onState={onState} notify={notify}/>}
        {section === 'sunnah' && <HadithLibrary collectionKey="bukhari" mode="memorization" state={state} onState={onState} notify={notify}/>}
        {section === 'routine' && <QuranRoutine asset={asset} state={state} onState={onState} tasks={tasks} onTasks={onTasks} notify={notify} onOpenTasks={onOpenTasks}/>}
        {section === 'progress' && <QuranProgress asset={asset} state={state} onState={onState} notify={notify}/>}
        {section === 'azkar' && <AzkarLibrary/>}
      </>}

    <footer className="quran-footer-note">
      <p>نص المصحف: مجمع الملك فهد لطباعة المصحف الشريف (حفص، رسم عثماني). التحقق المستقل: Tanzil Project. لا يُعدّل النص القرآني داخل التطبيق، وأي تصحيح يمر باستبدال مصدر موثق.</p>
      <p>التأملات الشخصية خاصة، وليست تفسيرًا معتمدًا. لا تُعرض تلاوات أو أحاديث قبل اعتماد ترخيصها.</p>
    </footer>
  </div>;
}
