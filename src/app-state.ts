import {addGoodOpinionBook,legacyInitialCurriculum,mergeKnowledgeCurriculum,organizeJourneyCurriculum,refreshCurriculumResources,updateBeginningBooks,type Curriculum} from './curriculum';
import {type DayPlan} from './DayPlanner';
import {type DayRecords} from './day-tracking';
import {type Goal} from './goal-plan';
import {type PrayerLocation} from './prayer-location';
import {createQuranState} from './quran/learning';
import type {QuranLearningState} from './quran/types';

// أنواع الحالة المشتركة ومساعداتها، لاستخدامها في App والواجهات المستخرجة
export type View='home'|'day'|'tasks'|'week'|'month'|'goals'|'learn'|'quran'|'haramain'|'reflect'|'wird'|'circles'|'teacher'|'courses'|'study'|'shares'|'profile'|'settings'|'payment'|'paymentHistory';
export type Period='daily'|'weekly'|'monthly';
// doneKey: مفتاح الفترة التي تأشر فيها المهمة («يومي مع الله» جديد يوميًا، والأسبوعي والشهري مرتبطان بفترتهما)؛ راجع task-periods.ts
export type Task={id:string;title:string;period:Period;done:boolean;optional:boolean;weekStart?:string;monthKey?:string;scheduledDate?:string;doneKey?:string;sourceLabel?:string;source?:{groupId:string;revision:number;position:number}};
export type TaskSchedule={initialDate?:string;initialSlot?:string;initialTime?:string;confirmedDate?:string;confirmedSlot?:string;confirmedTime?:string;title:string;sourceLabel:string};
export type Wird={id:string;title:string;target:number;count:number;period:Period;periodKey:string};
export type State={curriculum?:Curriculum;curriculumProgress?:Record<string,number>;dayPlan?:DayPlan;dayRecords?:DayRecords;taskSchedules?:Record<string,TaskSchedule>;tasks:Task[];goals:Goal[];wirds:Wird[];reflections:{id:string;date:string;text:string}[];lessonStep:number;prayers:Record<string,string>;prayerLocation?:PrayerLocation;quran:QuranLearningState};

export const today=()=>new Date().toLocaleDateString('en-CA');
export const periodKey=(p:Period)=>{const d=new Date();if(p==='daily')return today();if(p==='monthly')return `${d.getFullYear()}-${d.getMonth()+1}`;const start=new Date(d.getFullYear(),0,1);return `${d.getFullYear()}-W${Math.ceil((((d.getTime()-start.getTime())/86400000)+start.getDay()+1)/7)}`};

export function createSeed():State{
  return {tasks:[
    {id:'d1',title:'قراءة ما تيسر من القرآن',period:'daily',done:false,optional:true},
    {id:'d2',title:'أذكار الصباح',period:'daily',done:false,optional:true},
    {id:'d3',title:'وقت للأسرة',period:'daily',done:false,optional:true},
    {id:'w1',title:'صلة رحم أو زيارة قريب',period:'weekly',done:false,optional:true},
    {id:'m1',title:'مراجعة أهداف الشهر',period:'monthly',done:false,optional:true},
  ],goals:[],wirds:[
    {id:'z1',title:'الاستغفار',target:100,count:0,period:'daily',periodKey:periodKey('daily')},
    {id:'z2',title:'الصلاة على النبي ﷺ',target:100,count:0,period:'weekly',periodKey:periodKey('weekly')},
  ],reflections:[],lessonStep:0,prayers:{},quran:createQuranState()};
}

export function load(storageKey='rabbani-v1'):State{return loadFromRaw(localStorage.getItem(storageKey))}

export function loadFromRaw(raw:string|null):State{
  try{
    if(raw){
      const x=JSON.parse(raw) as State;
      if((x.curriculum?.mediaVersion??0)>=13)return {...createSeed(),...x,quran:{...createQuranState(),...(x.quran??{})},curriculumProgress:x.curriculumProgress??x.curriculum?.progress??{},curriculum:x.curriculum?.mediaVersion===13?refreshCurriculumResources(x.curriculum):x.curriculum,wirds:(x.wirds||[]).map(w=>w.periodKey===periodKey(w.period)?w:{...w,count:0,periodKey:periodKey(w.period)})};
      if(x.curriculum){
        x.curriculum.units=x.curriculum.units.map(unit=>({...unit,resources:unit.resources.filter(resource=>resource.id!=='why-created-book'&&!(unit.id==='knowing'&&resource.id==='knowing-allah-book')),stations:unit.stations.map(station=>({...station,sourceIds:station.sourceIds.filter(id=>id!=='why-created-book'&&!(unit.id==='knowing'&&id==='knowing-allah-book'))}))}));
      }
      const defaults=legacyInitialCurriculum().units;
      const oldVideos=new Map(x.curriculum?.units.flatMap(unit=>unit.resources).filter(resource=>resource.id.startsWith('journey-video-')).map(resource=>[resource.id,resource])??[]);
      const units=x.curriculum?.units.map(existing=>{
        const latest=defaults.find(u=>u.id===existing.id);
        if(!latest||(x.curriculum?.mediaVersion??0)>=4)return existing;
        const videos=latest.resources.filter(resource=>resource.id.startsWith('journey-video-')).map(resource=>oldVideos.get(resource.id)??resource);
        return {...existing,resources:[...existing.resources.filter(resource=>!resource.id.startsWith('journey-video-')),...videos],stations:existing.stations.map((station,index)=>({...station,sourceIds:[...station.sourceIds.filter(id=>!id.startsWith('journey-video-')),...latest.stations[index].sourceIds.filter(id=>id.startsWith('journey-video-'))]})),status:'draft' as const,reviewer:'',reviewNote:'',revision:existing.revision+1};
      })??[];
      return {...createSeed(),...x,quran:{...createQuranState(),...(x.quran??{})},curriculumProgress:x.curriculumProgress??x.curriculum?.progress??{},curriculum:x.curriculum?refreshCurriculumResources(organizeJourneyCurriculum(mergeKnowledgeCurriculum({...x.curriculum,playlistImported:true,mediaVersion:12,units:[...units,...defaults.filter(u=>!units.some(existing=>existing.id===u.id))].map(unit=>{const migrated=(x.curriculum?.mediaVersion??0)<9&&unit.id==='beginning'?{...updateBeginningBooks(unit),status:'draft' as const,reviewer:'',reviewNote:'',revision:unit.revision+1}:unit;return (x.curriculum?.mediaVersion??0)<10&&migrated.id==='beginning'?addGoodOpinionBook(migrated):migrated})}))):undefined,wirds:(x.wirds||[]).map(w=>w.periodKey===periodKey(w.period)?w:{...w,count:0,periodKey:periodKey(w.period)})};
    }
  }catch{/* تجاهل: بيانات تالفة تعني البدء من الصفر */}
  return createSeed();
}
