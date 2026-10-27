import {Component, type ErrorInfo, type ReactNode} from 'react';

type Props={children: ReactNode};
type State={hasError:boolean};

// حاجز أخطاء عام: عند أي خلل غير متوقع لا تتحول الصفحة إلى فراغ،
// بل تتوفر شاشة استرجاع لتصدير بيانات المتصفح ثم إعادة التحميل أو إعادة الضبط.
export default class ErrorBoundary extends Component<Props,State> {
  override state: State = {hasError:false};

  static getDerivedStateFromError(): State {
    return {hasError:true};
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('خطأ غير متوقع في المنصة:', error, info.componentStack);
  }

  private exportData=()=>{
    try{
      const raw=localStorage.getItem('rabbani-v1');
      if(!raw)return;
      const a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
      a.download='rabbaniyyun-data.json';
      a.click();
      URL.revokeObjectURL(a.href);
    }catch(exception){
      console.error('تعذر تصدير البيانات:', exception);
    }
  };

  private reload=()=>window.location.reload();

  private reset=()=>{
    if(window.confirm('هل تريد حذف كل البيانات المحلية في هذا المتصفح؟ لا يمكن التراجع. هل صدّرت بياناتك أولًا؟')){
      try{localStorage.removeItem('rabbani-v1')}catch{/* تجاهل */}
      window.location.reload();
    }
  };

  override render() {
    if(!this.state.hasError) return this.props.children;
    return <div dir="rtl" style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#163d34',color:'#f4f1ea',fontFamily:'Tajawal, sans-serif',padding:'24px'}}>
      <div style={{maxWidth:560,textAlign:'center',display:'grid',gap:16}}>
        <h1 style={{fontSize:24,margin:0}}>حدث خطأ غير متوقع</h1>
        <p style={{fontSize:15,lineHeight:1.8,margin:0}}>توقفت الواجهة عن العمل بسبب خلل تقني. بياناتك المحفوظة في هذا المتصفح لا تزال موجودة. يمكنك تصديرها قبل إعادة تحميل الصفحة، أو إعادة الضبط إذا كانت بياناتك تالفة.</p>
        <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
          <button onClick={this.exportData} style={btn('#f4f1ea','#163d34')}>تصدير البيانات المحفوظة</button>
          <button onClick={this.reload} style={btn('transparent')}>إعادة تحميل الصفحة</button>
          <button onClick={this.reset} style={btn('transparent')}>حذف البيانات وإعادة الضبط</button>
        </div>
      </div>
    </div>;
  }
}

function btn(foreground:string, background:string='rgba(244,241,234,0.12)'): React.CSSProperties {
  return {border:`1px solid ${foreground==='#163d34'?'transparent':'rgba(244,241,234,0.4)'}`,borderRadius:10,padding:'10px 18px',fontSize:14,cursor:'pointer',color:foreground,background};
}
