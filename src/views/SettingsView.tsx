import {Globe,Lock,RotateCcw,UserRound} from 'lucide-react';
import {type State,periodKey,createSeed} from '../app-state';

type Props={state:State;onReplace:(state:State)=>void;notify:(message:string)=>void;onOpenProfile?:()=>void};

// إعدادات المستخدم: الملف الشخصي وإعدادات الحساب، وتصدير واستيراد بيانات المتصفح وإعادة الضبط.
export default function SettingsView({state,onReplace,notify,onOpenProfile}:Props) {
  const exportData=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));a.download='rabbaniyyun-data.json';a.click();URL.revokeObjectURL(a.href)};
  const importData=(file:File)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const parsed=JSON.parse(String(reader.result)) as Partial<State>;
        if(!parsed||typeof parsed!=='object'||!Array.isArray(parsed.tasks)||!Array.isArray(parsed.goals)||!Array.isArray(parsed.wirds)||!Array.isArray(parsed.reflections)){notify('الملف لا يبدو نسخة صحيحة من بيانات المنصة.');return}
        const wirds=parsed.wirds;
        onReplace({...createSeed(),...parsed,wirds:wirds.map(w=>({...w,periodKey:periodKey(w.period)})),curriculum:parsed.curriculum??state.curriculum});
        notify('استُعيدت بياناتك في هذا المتصفح');
      }catch{notify('تعذر قراءة الملف. تأكد أنه JSON صحيح.')}
    };
    reader.onerror=()=>notify('تعذر فتح الملف.');
    reader.readAsText(file);
  };
  const reset=()=>{
    if(window.confirm('هل تريد حذف كل البيانات المحلية؟ لا يمكن التراجع.')){onReplace(createSeed());notify('تمت إعادة الضبط')}
  };
  return <><div className="page-intro"><span className="eyebrow">المنصة</span><h1>الإعدادات والبيانات</h1><p>نسخة تجريبية تعمل محليًا في المتصفح، وتُزامَن بيانات حسابك في السحابة عند تسجيل الدخول.</p></div>{onOpenProfile&&<section className='panel'><h3><UserRound size={18}/> الملف الشخصي وإعدادات الحساب</h3><p className="muted">اسمك وبلدك وعمرك، والمنطقة الزمنية واللغة والمدينة ومواعيد اليوم، وتفضيلات الإشعارات، وحذف الحساب.</p><button className="primary" onClick={onOpenProfile}><Globe size={17}/> فتح حسابي</button></section>}<section className='panel'><h3><Lock size={18}/> الخصوصية</h3><p className="muted">اسمك وبلدك وعمرك ملكك وحدك ولا يظهران لغيرك. محاسبة نفسك («حاسب نفسك») لا تُعرض على أحد ولا تدخل في أي إجمالي. الحلقات خاصة ولا يوجد دليل عام. لا تُسجَّل لقاءات Meet داخل المنصة.</p></section><section className='panel'><h3>تصدير بياناتك</h3><p className="muted">احتفظ بنسخة JSON من أنشطتك وأهدافك ومحاسبتك.</p><button className="primary" onClick={exportData}>تصدير البيانات</button></section><section className='panel'><h3>استيراد البيانات</h3><p className="muted">استعد نسخة JSON صدّرتها من هذا الجهاز أو جهاز آخر. ستُستبدل البيانات الحالية المحفوظة في هذا المتصفح.</p><input type="file" accept="application/json,.json" aria-label="ملف بيانات JSON" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)importData(file)}}/></section><section className="panel"><h3>إعادة ضبط التجربة</h3><p className="muted">سيحذف هذا جميع بياناتك المحلية في هذا المتصفح.</p><button className="outline-danger" onClick={reset}><RotateCcw size={17}/> حذف البيانات المحلية</button></section></>;
}

