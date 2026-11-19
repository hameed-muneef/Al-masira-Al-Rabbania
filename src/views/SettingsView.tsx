import {Globe,Lock,RotateCcw,UserRound} from 'lucide-react';
import {type State,createSeed} from '../app-state';
import NotificationSettings from './notifications/NotificationSettings';
import {AppearancePanel} from '../AppearanceToggle';
import {InstallGuidePanel} from '../InstallApp';
import {LOCAL_ONLY} from '../config';

type Props={state:State;onReplace:(state:State)=>void;notify:(message:string)=>void;onOpenProfile?:()=>void};

// إعدادات المستخدم: الحساب (في نسخة السحابة)، والتنبيهات والمظهر والخصوصية،
// وإعادة ضبط البيانات. لا يوجد تصدير أو استيراد نسخ احتياطية إطلاقًا:
// البيانات تبقى على هذا الجهاز وحده.
export default function SettingsView({state,onReplace,notify,onOpenProfile}:Props) {
  const reset=()=>{
    if(window.confirm('هل تريد حذف كل البيانات المحلية في هذا الجهاز؟ لا يمكن التراجع.')){onReplace(createSeed());notify('تمت إعادة الضبط')}
  };
  return <>
    <div className="page-intro"><span className="eyebrow">المنصة</span><h1>الإعدادات والبيانات</h1><p>{LOCAL_ONLY?'نسخة محلية تعمل على هذا الجهاز وحده: لا حساب ولا مزامنة سحابية ولا نسخ احتياطية خارجية.':'نسخة تجريبية تعمل محليًا في المتصفح، وتُزامَن بيانات حسابك في السحابة عند تسجيل الدخول.'}</p></div>
    {!LOCAL_ONLY&&onOpenProfile&&<section className='panel'><h3><UserRound size={18}/> الملف الشخصي وإعدادات الحساب</h3><p className="muted">اسمك وبلدك، والمنطقة الزمنية واللغة والمدينة ومواعيد اليوم، وتفضيلات الإشعارات، وحذف الحساب.</p><button className="primary" onClick={onOpenProfile}><Globe size={17}/> فتح حسابي</button></section>}
    <NotificationSettings notify={notify} prayerLocation={state.prayerLocation} onPrayerLocation={prayerLocation=>onReplace({...state,prayerLocation})} goals={state.goals.map(goal=>({id:String(goal.id),title:String((goal as {title?:string}).title??'')}))}/>
    <AppearancePanel/>
    <InstallGuidePanel/>
    <section className='panel'><h3><Lock size={18}/> الخصوصية</h3><p className="muted">اسمك وبلدك ملكك وحدك ولا يظهران لغيرك. محاسبة نفسك («حاسب نفسك») لا تُعرض على أحد ولا تدخل في أي إجمالي.</p></section>
    <section className="panel"><h3>بياناتك على هذا الجهاز</h3><p className="muted">كل ما تكتبه — مهامك وأهدافك وأورادك ومحاسبتك وقراءتك — يُحفظ على هذا الجهاز فقط. لا يُرسل إلى خادم، ولا تُصدَّر نسخة احتياطية إلى ملف خارجي، ولا تُستورد نسخة من جهاز آخر. إن حذفت بيانات المتصفح أو التطبيق ضاعت بياناتك، فاحتفظ بجهازك آمنًا.</p><button className="outline-danger" onClick={reset}><RotateCcw size={17}/> حذف البيانات المحلية</button></section>
  </>;
}
