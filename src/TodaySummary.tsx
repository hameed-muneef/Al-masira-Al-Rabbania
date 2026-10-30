import {useMemo,useState} from 'react';
import {CalendarClock,ChevronLeft} from 'lucide-react';
import {type Task,today} from './app-state';
import {isTaskDone} from './task-periods';
type Filter='today'|'tomorrow'|'overdue';
export default function TodaySummary({tasks,navigate}:{tasks:Task[];navigate:(view:'day')=>void}){
  const [filter,setFilter]=useState<Filter>('today'); const now=today(); const next=new Date(`${now}T00:00:00`); next.setDate(next.getDate()+1); const tomorrow=next.toLocaleDateString('en-CA');
  const items=useMemo(()=>tasks.filter(task=>{if(isTaskDone(task))return false;if(filter==='today')return task.period==='daily'||task.scheduledDate===now;if(filter==='tomorrow')return task.scheduledDate===tomorrow;return Boolean(task.scheduledDate&&task.scheduledDate<now)}),[tasks,filter,now,tomorrow]);
  const source=(task:Task)=>task.source?'مجلس علم':task.period==='daily'?'يومي':task.period==='weekly'?'أسبوعي':'شهري';
  return <section className="panel today-summary" aria-labelledby="today-summary-title"><div className="panel-head"><CalendarClock size={20}/><h2 id="today-summary-title">ما المهم؟</h2></div><div className="today-summary-tabs" role="tablist" aria-label="مهام قريبة الاستحقاق"><button className={filter==='today'?'primary':'soft-btn'} onClick={()=>setFilter('today')} role="tab" aria-selected={filter==='today'}>اليوم</button><button className={filter==='tomorrow'?'primary':'soft-btn'} onClick={()=>setFilter('tomorrow')} role="tab" aria-selected={filter==='tomorrow'}>غدًا</button><button className={filter==='overdue'?'primary':'soft-btn'} onClick={()=>setFilter('overdue')} role="tab" aria-selected={filter==='overdue'}>متأخرة</button></div>{items.length===0?<p className="muted small">لا توجد مهام في هذه القائمة.</p>:<ul className="today-summary-list">{items.slice(0,6).map(task=><li key={task.id}><span><strong>{task.title}</strong><small>{source(task)}</small></span><ChevronLeft size={15}/></li>)}</ul>}{items.length>6&&<p className="muted small">توجد {items.length-6} مهام أخرى داخل «يومي مع الله».</p>}<button className="soft-btn today-summary-link" onClick={()=>navigate('day')}>فتح يومي مع الله <ChevronLeft size={15}/></button></section>;
}
