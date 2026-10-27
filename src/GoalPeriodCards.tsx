import {CalendarDays,CalendarRange,CalendarCheck,CalendarClock} from 'lucide-react';
import {goalPeriodKey,goalPeriodLabel,goalPeriods,goalSteps,stepsForPeriod,type Goal,type GoalPeriod} from './goal-plan';

type Props={goals:Goal[];onGoals:(goals:Goal[])=>void};
const config:Record<GoalPeriod,{title:string;empty:string;icon:typeof CalendarDays}>={
  daily:{title:'خطوات اليوم',empty:'لا توجد خطوات يومية بعد.',icon:CalendarDays},
  weekly:{title:'خطوات الأسبوع',empty:'لا توجد خطوات أسبوعية بعد.',icon:CalendarRange},
  monthly:{title:'خطوات الشهر',empty:'لا توجد خطوات شهرية بعد.',icon:CalendarCheck},
  yearly:{title:'خطوات السنة',empty:'لا توجد خطوات سنوية بعد.',icon:CalendarClock},
};
export default function GoalPeriodCards({goals,onGoals}:Props){
  const toggle=(goalId:string,stepId:string,period:GoalPeriod,checked:boolean)=>{
    const key=goalPeriodKey(period);
    onGoals(goals.map(goal=>goal.id===goalId?{...goal,steps:goalSteps(goal).map(step=>step.id===stepId?{...step,done:{...step.done,[key]:checked}}:step)}:goal));
  };
  return <section className="goal-period-section" aria-label="خطوات الأهداف حسب الفترة"><div className="goal-period-heading"><div><span className="eyebrow">متابعة خطواتك</span><h2>ما الذي تعمل عليه الآن؟</h2><p>الخطوات التي تضيفها لكل هدف تظهر هنا تلقائيًا حسب تكرارها.</p></div></div><div className="goal-period-grid">{goalPeriods.map(period=>{const entries=stepsForPeriod(goals,period);const key=goalPeriodKey(period);const done=entries.filter(entry=>entry.step.done[key]).length;const Icon=config[period].icon;return <article className={`goal-period-card goal-period-card-${period}`} key={period}><div className="goal-period-card-head"><span className="goal-period-icon"><Icon size={21}/></span><div className="goal-period-title"><h3>{config[period].title}</h3><small>{goalPeriodLabel(period,key)}</small></div><span className="goal-period-count" aria-label={`${done} من ${entries.length} خطوات مكتملة`}>{done.toLocaleString('ar-EG')} <span>من</span> {entries.length.toLocaleString('ar-EG')}</span></div><div className="goal-period-card-list">{entries.length===0?<p className="goal-period-empty">{config[period].empty}</p>:entries.map(({goalId,goalTitle,step})=><label className="goal-period-item" key={`${goalId}:${step.id}`}><input type="checkbox" aria-label={`إنجاز ${step.title} ضمن ${config[period].title}`} checked={!!step.done[key]} onChange={event=>toggle(goalId,step.id,period,event.target.checked)}/><span><strong className={step.done[key]?'completed':''}>{step.title}</strong><small>هدف: {goalTitle}</small></span></label>)}</div></article>})}</div></section>;
}
