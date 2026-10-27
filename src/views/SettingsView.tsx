import {RotateCcw} from 'lucide-react';
import {type State,periodKey,createSeed} from '../app-state';

type Props={state:State;onReplace:(state:State)=>void;notify:(message:string)=>void};

// إعدادات المستخدم: تصدير واستيراد بيانات المتصفح وإعادة الضبط.
export default function SettingsView({state,onReplace,notify}:Props) {
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
  return <><div className="page-intro"><span className="eyebrow">المنصة</span><h1>الإعدادات والبيانات</h1><p>النسخة التجريبية تعمل محليًا في المتصفح، دون تسجيل حساب أو إرسال بياناتك إلى خادم.</p></div><section className='panel'><h3>تصدير بياناتك</h3><p className="muted">احتفظ بنسخة JSON من أنشطتك وأهدافك ومحاسبتك.</p><button className="primary" onClick={exportData}>تصدير البيانات</button></section><section className='panel'><h3>استيراد البيانات</h3><p className="muted">استعد نسخة JSON صدّرتها من هذا الجهاز أو جهاز آخر. ستُستبدل البيانات الحالية المحفوظة في هذا المتصفح.</p><input type="file" accept="application/json,.json" aria-label="ملف بيانات JSON" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)importData(file)}}/></section><section className="panel"><h3>إعادة ضبط التجربة</h3><p className="muted">سيحذف هذا جميع بياناتك المحلية في هذا المتصفح.</p><button className="outline-danger" onClick={reset}><RotateCcw size={17}/> حذف البيانات المحلية</button></section></>;
}

