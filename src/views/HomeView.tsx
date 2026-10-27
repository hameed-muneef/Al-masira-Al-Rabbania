import {BookOpen,CalendarDays,Heart,Target,ChevronLeft,ArrowRight,Flower2} from 'lucide-react';
import {type View} from '../app-state';

const menu:Array<{id:'day'|'week'|'month'|'goals';title:string;icon:typeof CalendarDays;desc:string}>=[
  {id:'day',title:'يومي مع الله',icon:CalendarDays,desc:'خطوات اليوم ومواعيده'},
  {id:'week',title:'أسبوعي مع الله',icon:CalendarDays,desc:'خطة الأسبوع'},
  {id:'month',title:'شهري مع الله',icon:CalendarDays,desc:'أهداف الشهر'},
  {id:'goals',title:'المؤمن القوي',icon:Target,desc:'أهداف نافعة وخطوات عملية'},
];

export default function HomeView({navigate}:{navigate:(view:View)=>void}) {
  return <><section className="hero"><div className="hero-pattern"/><div className="hero-content"><span className="hero-tag"><Flower2 size={15}/> بسم الله الرحمن الرحيم</span><h1>مرحبًا بك في مسيرتك</h1><p>خطوات يسيرة في العلم والإيمان والعمل الصالح، تمضي بها على بصيرة، بما يناسب يومك وظروفك.</p><button className="hero-btn" onClick={()=>navigate('day')}>ابدأ يومك <ArrowRight size={18}/></button></div><div className="hero-art"><div className="arch"><BookOpen size={64} strokeWidth={1.1}/><span>وَكُونُوا رَبَّانِيِّينَ</span></div></div></section><div className="section-title"><div><span className="eyebrow">01 / تنظيم الحياة</span><h2>حياتي مع الله</h2><p>اجعل العبادة والعمل والأسرة والتعلم في خطة متوازنة.</p></div></div><div className="feature-grid">{menu.map((m,i)=><button key={m.id} className="feature-card" onClick={()=>navigate(m.id)}><span className={`feature-icon icon-${i}`}><m.icon size={24}/></span><strong>{m.title}</strong><span>{m.desc}</span><ChevronLeft className="feature-arrow" size={18}/></button>)}</div><div className="section-title below"><div><span className="eyebrow">02 / العلم والتزكية</span><h2>نمضي بعلم وعمل</h2></div></div><div className="large-grid"><button className="wide-card" onClick={()=>navigate('learn')}><div className="wide-icon"><BookOpen size={28}/></div><div><h3>السير إلى الله</h3><p>منهج متدرج، محطة بعد محطة، لفهم الدين والعمل به.</p><span className="inline-link">متابعة المسيرة <ChevronLeft size={17}/></span></div></button><button className="wide-card" onClick={()=>navigate('reflect')}><div className="wide-icon blush"><Heart size={28}/></div><div><h3>حاسب نفسك</h3><p>محاسبة خاصة وأوراد تختارها بنفسك دون مقارنة أو درجات.</p><span className="inline-link">الدخول إلى القسم <ChevronLeft size={17}/></span></div></button></div><div className="quote">«احرص على ما ينفعك، واستعن بالله ولا تعجز» <span>— صحيح مسلم</span></div></>;
}
