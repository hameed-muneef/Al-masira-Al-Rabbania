import {useEffect,useState} from 'react';
import DayTracker from './DayTracker';
import type {Task} from './app-state';
import {scheduledTasksForDate} from './weekly-planning';
import './weekly-planning.css';
import DayMessage, {resolveMessage} from './DayMessage';
import {openingMessage} from './day-message';
import {createDayRecord,localDateKey,type DayRecords} from './day-tracking';
import usePrayerTimes from './usePrayerTimes';
import {offsetTime,timeLabel,activitySchedule,type ActivityTiming} from './day-timing';
export {offsetTime} from './day-timing';
import {BookOpen, CalendarDays, Check, Clock, Heart, Plus, Sun, Trash2} from 'lucide-react';

type Activity = {id: string; title: string; timing?: ActivityTiming; duration?:number};
export type DayPlan = {activities: Record<string, Activity[]>; completed: Record<string, string>; workStart: string; sleep: string};
type Props = {scheduledTasks:Task[];onWeek:()=>void;onMonth:()=>void;plan?: DayPlan; records?:DayRecords; dailyTasks:{id:string;title:string}[]; onRecords:(records:DayRecords)=>void; prayers: Record<string, string>; onPlan: (plan: DayPlan) => void; onPrayer: (name: string, time: string) => void; onReflect: () => void; extraTasks: React.ReactNode};
const slots = [
  {id:'before', title:'قبل الفجر بنصف ساعة', items:['قيام وذكر ودعاء بحسب الاستطاعة']},
  {id:'fajr', title:'صلاة الفجر', prayer:true, items:[]},
  {id:'morning', title:'من بعد الفجر إلى الشروق', items:['أذكار الصباح','قراءة ما تيسر من القرآن']},
  {id:'sunrise', title:'بعد الشروق · الاستعداد لليوم', items:['إفطار واستعداد لليوم']},
  {id:'work', title:'العمل أو الدراسة حتى الظهر', items:['عمل أو دراسة مع استحضار النية']},
  {id:'dhuhr', title:'صلاة الظهر', prayer:true, items:[]},
  {id:'afternoon', title:'بعد الظهر إلى العصر', items:['استكمال العمل أو الدراسة','طعام وراحة بحسب الحاجة']},
  {id:'asr', title:'صلاة العصر', prayer:true, items:[]},
  {id:'evening', title:'بعد العصر إلى المغرب', items:['مسؤوليات وأسرة أو رياضة','أذكار المساء في وقتها المناسب']},
  {id:'maghrib', title:'صلاة المغرب', prayer:true, items:[]},
  {id:'sunset', title:'بين المغرب والعشاء', items:['قرآن أو تعلم أو وقت للأسرة']},
  {id:'isha', title:'صلاة العشاء', prayer:true, items:[]},
  {id:'night', title:'بعد العشاء وحتى النوم', items:['وقت للأسرة','مراجعة اليوم وإعداد الغد','أذكار النوم']},
];
const phaseBySlot:Record<string,string>={before:'before',fajr:'morning',morning:'morning',sunrise:'morning',work:'morning',dhuhr:'midday',afternoon:'midday',asr:'afternoon',evening:'afternoon',maghrib:'sunset',sunset:'sunset',isha:'night',night:'night'};
export const initialDayPlan = (): DayPlan => ({activities:Object.fromEntries(slots.filter(s=>!s.prayer).map(s=>[s.id,s.items.map((title,i)=>({id:`${s.id}-${i}`,title}))])),completed:{},workStart:'',sleep:''});
export default function DayPlanner({scheduledTasks,onWeek,onMonth,plan,records={},dailyTasks,onRecords,prayers:manualPrayers,onPlan,onPrayer,onReflect,extraTasks}:Props) {
  const [today,setToday]=useState(localDateKey);
  const [selectedDate,setSelectedDate]=useState(localDateKey);
  const [tab,setTab]=useState<'home'|'plan'|'track'>('home');
  const [message,setMessage]=useState<'opening'|'resolve'|null>(null);
  useEffect(()=>{
    const check=()=>{const next=localDateKey();if(next!==today){setToday(next);setSelectedDate(selected=>selected===today?next:selected)}};
    const timer=window.setInterval(check,30000);
    window.addEventListener('focus',check);
    return ()=>{clearInterval(timer);window.removeEventListener('focus',check)};
  },[today]);
  const [automatic,setAutomatic]=useState(true);
  const locationTimes=usePrayerTimes(automatic && tab==='plan');
  const prayers=automatic ? locationTimes.prayers : manualPrayers;
  const day=plan ?? initialDayPlan();
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [editing,setEditing]=useState<string | null>(null);
  const [editText,setEditText]=useState('');
  const [editingTime,setEditingTime]=useState<string|null>(null);
  const [durationDraft,setDurationDraft]=useState('30');
  const range=(start?:string,end?:string)=>start && end ? `${timeLabel(start)} — ${timeLabel(end)}` : start ? 'من '+timeLabel(start) : end ? 'حتى '+timeLabel(end) : 'تتحدد بعد ضبط المواقيت';
  const timing:Record<string,string>={before:range(offsetTime(prayers['الفجر'],-30),prayers['الفجر']),fajr:timeLabel(prayers['الفجر']),morning:range(prayers['الفجر'],prayers['الشروق']),sunrise:range(prayers['الشروق'],day.workStart),work:range(day.workStart,prayers['الظهر']),dhuhr:timeLabel(prayers['الظهر']),afternoon:range(prayers['الظهر'],prayers['العصر']),asr:timeLabel(prayers['العصر']),evening:range(prayers['العصر'],prayers['المغرب']),maghrib:timeLabel(prayers['المغرب']),sunset:range(prayers['المغرب'],prayers['العشاء']),isha:timeLabel(prayers['العشاء']),night:range(prayers['العشاء'],day.sleep)};
  const ordered=['الفجر','الشروق','الظهر','العصر','المغرب','العشاء'].map(n=>prayers[n]);
  const invalidOrder=ordered.some((t,i)=>t && ordered.slice(0,i).some(prev=>prev && prev>=t));
  const workConflict=day.workStart && ((prayers['الشروق'] && day.workStart<prayers['الشروق']) || (prayers['الظهر'] && day.workStart>=prayers['الظهر']));
  const anchors={...prayers,'بداية العمل':day.workStart,'موعد النوم':day.sleep};
  const setActivities=(id:string,items:Activity[])=>onPlan({...day,activities:{...day.activities,[id]:items}});
  const dueTasks=scheduledTasksForDate(scheduledTasks,today);
  const startTracking=()=>{
    const date=localDateKey();
    const scheduled=scheduledTasksForDate(scheduledTasks,date);
    const record=createDayRecord(date,slots,day,anchors,[...dailyTasks,...scheduled],records[date]);
    record.items=record.items.map(item=>{const task=scheduled.find(task=>item.id===`extra:${task.id}`);return task?{...item,period:task.period==='monthly'?'من خطة الشهر':'من خطة الأسبوع',status:task.done?'done':item.status==='deferred'?'deferred':'pending'}:item});
    onRecords({...records,[date]:{...record,openingMessage,resolveMessage}});
    setToday(date);setSelectedDate(date);setTab('track');window.scrollTo({top:0,behavior:'smooth'});
    setMessage('resolve');
  };
  return <div className="day-planner">
    <header className="day-page-header"><div className="page-intro day-intro"><div><span className="eyebrow">حياتي مع الله · يومٌ بمعنى</span><h1>يومي مع الله</h1><p>خطّط لما ينفعك، وتابع أعمالك يومًا بيوم.</p></div><div className="day-header-date"><CalendarDays size={20}/><span>اليوم</span><strong>{new Intl.DateTimeFormat('ar-EG',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(`${today}T12:00:00`))}</strong></div></div>
    <div className="day-view-switch" aria-label="عرض يومي مع الله"><button type="button" aria-pressed={tab==='plan'} className={tab==='plan'?'selected':''} onClick={()=>setMessage('opening')}>تخطيط يومي</button><button type="button" aria-pressed={tab==='track'} className={tab==='track'?'selected':''} onClick={()=>{setSelectedDate(localDateKey());setTab('track')}}>متابعة اليوم</button></div></header>
    {tab==='track' ? <DayTracker records={records} date={selectedDate} today={today} onDate={setSelectedDate} onRecords={onRecords} onPlan={()=>setMessage('opening')}/> : tab==='plan' ? <div className="day-plan-content">
    {dueTasks.length>0&&<section className="weekly-due" role="status" aria-live="polite"><h2>تذكير: لديك مهام مجدولة لليوم</h2><p>راعِ هذه المهام عند ترتيب يومك. ستظهر أيضًا عند حفظ أو تحديث متابعة اليوم.</p><ul>{dueTasks.map(task=><li key={task.id}><span className={task.done?'completed':''}>{task.title}</span> · {task.period==='monthly'?'من خطة الشهر':'من خطة الأسبوع'}{task.done&&' · مكتملة'}</li>)}</ul>{dueTasks.some(task=>task.period==='weekly')&&<button type="button" className="soft-btn" onClick={onWeek}>مراجعة خطة الأسبوع</button>} {dueTasks.some(task=>task.period==='monthly')&&<button type="button" className="soft-btn" onClick={onMonth}>مراجعة خطة الشهر</button>}</section>}
    <div className="day-start-bar"><div><strong>خطة {new Intl.DateTimeFormat('ar-EG',{day:'numeric',month:'long',year:'numeric'}).format(new Date(`${today}T12:00:00`))}</strong><p>استخدم خطتك المعتادة، ثم احفظ قائمة مستقلة لمتابعة أعمال اليوم.</p></div><button className="primary" disabled={invalidOrder || (automatic && locationTimes.loading)} onClick={startTracking}>{records[today]?'تحديث متابعة اليوم':'ابدأ متابعة اليوم'}</button></div>
    <section className="intention-card" aria-labelledby="intention-title">
      <span className="hero-tag"><Heart size={17}/> وقفة الفجر · استقبل يومك مع الله</span>
      <h2 id="intention-title">ليكن يومك لله</h2>
      <blockquote>﴿قُلْ إِنَّ صَلَاتِي وَنُسُكِي وَمَحْيَايَ وَمَمَاتِي لِلَّهِ رَبِّ الْعَالَمِينَ﴾</blockquote>
      <span className="verse-source">سورة الأنعام · الآية ١٦٢</span>
      <p>ابدأ يومك مستعينًا بالله. استحضر الإخلاص في عبادتك، والنية الصالحة في عملك ودراستك ورعايتك لأهلك، واحرص على حفظ لسانك وأداء حقوق الناس.</p>
      <div className="intention-prompts"><span>ما الخير الذي أريد أن أعمله اليوم؟</span><span>ما الحق الذي أريد أن أؤديه؟</span><span>كيف أنفع أهلي ومن حولي؟</span></div>
      <small>النية محلها القلب؛ هذه أسئلة للتأمل، ولا يلزم التلفظ بصيغة أو تسجيل إجابة.</small>
    </section>
    <details className="panel day-settings" open={!prayers['الفجر']}>
      <summary><Clock size={18}/> مواقيت يومك وتخصيصه</summary>
      <p className="muted small">نستخدم موقع جهازك بعد إذنك لجلب مواقيت اليوم من AlAdhan، ونعرضها بتوقيت جهازك. تُرسل الإحداثيات لخدمة المواقيت. يمكنك اختيار الإدخال اليدوي لمطابقة تقويم مسجدك.</p>
      <div className="prayer-location-controls"><label><input type="checkbox" checked={automatic} onChange={e=>setAutomatic(e.target.checked)}/> تحديد المواقيت تلقائيًا حسب موقعي</label>{automatic && <button type="button" className="soft-btn" disabled={locationTimes.loading} onClick={locationTimes.refresh}>تحديث الموقع والمواقيت</button>}</div>{automatic && <p role="status" className="muted small">{locationTimes.status}</p>}<div className="prayer-grid">{['الفجر','الشروق','الظهر','العصر','المغرب','العشاء'].map(n=><label className="prayer" key={n}>{n}<input type="time" readOnly={automatic} aria-label={`وقت ${n}`} value={prayers[n]||''} onChange={e=>onPrayer(n,e.target.value)}/></label>)}</div>
      <div className="form-grid personal-times"><label>بداية العمل أو الدراسة<input type="time" value={day.workStart} onChange={e=>onPlan({...day,workStart:e.target.value})}/></label><label>موعد النوم<input type="time" value={day.sleep} onChange={e=>onPlan({...day,sleep:e.target.value})}/></label></div>
      {invalidOrder && <p role="alert" className="schedule-warning">راجع ترتيب المواقيت: الفجر، ثم الشروق، ثم الظهر والعصر والمغرب والعشاء.</p>}
      {workConflict && <p role="alert" className="schedule-warning">هذا القالب يقترح العمل بين الشروق والظهر. يمكنك تعديل الأنشطة بما يناسب مناوبتك؛ راجع موعد البداية لتتوافق حدود الفترات.</p>}
    </details>
    <div className="section-title" id="day-timeline"><span className="eyebrow">من قبل الفجر إلى النوم</span><h2>أعمال صغيرة، ويوم عامر بالخير</h2><p>اختر ما ينفعك، وأنجزه على مهل. مواعيد أنشطتك تتنظم تلقائيًا حول الصلاة.</p></div>
    <div className="day-timeline">{[slots.slice(0,7).map((slot,index)=>({slot,index})),slots.slice(7).map((slot,index)=>({slot,index:index+7}))].map((group,groupIndex)=><div className="day-timeline-column" key={groupIndex}><h3 className="day-timeline-column-heading">{groupIndex===0?'من قبل الفجر إلى العصر':'من العصر إلى النوم'}</h3>{group.map(({slot,index})=>{
      const items=day.activities[slot.id] ?? [];
      const schedule=activitySchedule(slot.id,items,anchors);
      return <section key={slot.id} className={`day-slot phase-${phaseBySlot[slot.id]} ${slot.prayer?'prayer-slot':''}`} aria-labelledby={`slot-${slot.id}`}>
        <span className="slot-marker">{slot.prayer?<Sun size={17}/>:String(index+1).padStart(2,'0')}</span>
        <div className="slot-body"><div className="slot-heading"><h3 id={`slot-${slot.id}`}>{slot.prayer&&<small className="prayer-kicker">موعد الصلاة</small>}{slot.title}</h3><span className="slot-time"><Clock size={14}/>{invalidOrder?'راجع المواقيت':timing[slot.id] || 'أدخل وقت الصلاة'}</span></div>
        {slot.prayer ? <p className="prayer-note">محطة الصلاة · مع مراعاة الأعذار والأحوال الشخصية.</p> : <>
          {items.map((item,itemIndex)=>{const {start:resolved,end,duration}=schedule[itemIndex];return <div className="slot-activity" key={item.id}>
            <div className="task-main">{editing===item.id ? <span className="muted">تعديل النشاط</span>:<span className="activity-title">{item.title}</span>}</div>
            {editing===item.id ? <form className="activity-edit" onSubmit={e=>{e.preventDefault();if(editText.trim()){setActivities(slot.id,items.map(a=>a.id===item.id?{...a,title:editText.trim()}:a));setEditing(null)}}}><input autoFocus aria-label="اسم النشاط" required value={editText} onChange={e=>setEditText(e.target.value)}/><button className="soft-btn" type="submit">حفظ</button><button className="icon-btn" type="button" onClick={()=>setEditing(null)}>إلغاء</button></form>:<button className="icon-btn" aria-label={`تعديل ${item.title}`} onClick={()=>{setEditing(item.id);setEditText(item.title)}}>تعديل</button>}
            <button className="icon-btn danger" aria-label={`حذف ${item.title}`} onClick={()=>setActivities(slot.id,items.filter(a=>a.id!==item.id))}><Trash2 size={15}/></button>
            <div className="activity-schedule"><span className="activity-time"><Clock size={14}/>{invalidOrder ? 'راجع المواقيت' : resolved.time ? `من ${timeLabel(resolved.time)} ${resolved.dayNote} إلى ${timeLabel(end.time)} ${end.dayNote}` : 'بانتظار تحديد المواقيت'}</span><span className="activity-duration">{duration.toLocaleString('ar-EG')} دقيقة</span><button type="button" className="icon-btn" aria-label={`تعديل وقت ${item.title}`} onClick={()=>{setEditingTime(item.id);setDurationDraft(String(duration))}}>تعديل الوقت</button>{editingTime===item.id && <form className="activity-duration-edit" onSubmit={e=>{e.preventDefault();const value=Number(durationDraft);if(!Number.isInteger(value)||value<1||value>720)return;setActivities(slot.id,items.map(a=>a.id===item.id?{...a,duration:value}:a));setEditingTime(null)}}><label>مدة النشاط بالدقائق<input autoFocus type="number" required min="1" max="720" step="1" aria-label={`مدة ${item.title} بالدقائق`} value={durationDraft} onChange={e=>setDurationDraft(e.target.value)}/></label><button className="soft-btn" type="submit">حفظ</button><button className="icon-btn" type="button" onClick={()=>setEditingTime(null)}>إلغاء</button></form>}</div>
          </div>})}
          {items.length===0 && <p className="muted small">مساحة متاحة لما يناسب يومك.</p>}
          <form className="add-row slot-add" onSubmit={e=>{e.preventDefault();const title=drafts[slot.id]?.trim();if(title){setActivities(slot.id,[...items,{id:crypto.randomUUID(),title}]);setDrafts({...drafts,[slot.id]:''})}}}><input aria-label={`نشاط جديد: ${slot.title}`} placeholder="أضف نشاطًا لهذه الفترة…" value={drafts[slot.id]||''} onChange={e=>setDrafts({...drafts,[slot.id]:e.target.value})}/><button className="soft-btn" aria-label={`إضافة نشاط: ${slot.title}`}><Plus size={17}/> إضافة</button></form>
          {slot.id==='sunrise' && <p className="slot-footnote">يمكنك إضافة الضحى في وقتها الصحيح بعد ارتفاع الشمس وقبل الزوال؛ بداية هذه الفترة ليست موعدًا لصلاة الضحى.</p>}
          {slot.id==='night' && <button className="soft-btn reflection-link" onClick={onReflect}><BookOpen size={16}/> وقفة مع النفس وإعداد الغد</button>}
        </>}
        </div>
      </section>;
    })}</div>)}</div>
    {extraTasks}
    <div className="day-start-bar"><p>جاهز؟ تابع كل أعمالك في قائمة واحدة بتاريخ اليوم. الأعمال بلا توقيت تظهر في نهاية القائمة، ويمكنك ضبطها ثم تحديث المتابعة.</p><button className="primary" disabled={invalidOrder || (automatic && locationTimes.loading)} onClick={startTracking}>{records[today]?'تحديث متابعة اليوم':'ابدأ متابعة اليوم'}</button></div>
    <div className="hint"><Check size={17}/> تعديلات الخطة تُطبّق على المتابعة عند الحفظ، مع الاحتفاظ بحالة الأعمال الموجودة. سجلات الأيام السابقة تبقى كما هي.</div>
    </div> : null}
    {message && <DayMessage kind={message} onClose={()=>{if(message==='opening')setTab('plan');setMessage(null)}}/>}
  </div>;
}








