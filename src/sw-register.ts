// تسجيل service worker مع تحديث تلقائي: عند جاهزية نسخة جديدة (وكانت النسخة القديمة
// تتحكم في الصفحة) يُعاد تحميل الصفحة مرة واحدة تلقائيًا — لا حاجة إلى refresh يدوي.
// الملفات الضخمة (حديث/قرآن/كتب/خط) تُخزَّن عند الطلب (runtimeCaching في vite.config.ts)
// كي يكتمل تثبيت النسخة الجديدة بسرعة ولا تظل الصفحة تعرض النسخة القديمة طويلًا.
let reloaded = false;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // إعادة تحميل واحدة عند تولي service worker جديد للسيطرة على الصفحة.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      // أول تثبيت على الجهاز: الصفحة أصلاً بالنسخة الجديدة — لا إعادة تحميل.
      if (!navigator.serviceWorker.controller) return;
      window.location.reload();
    });
    navigator.serviceWorker.register('/sw.js', {scope: '/'}).catch(() => { /* لا شيء — العمل دون SW ممكن */ });
  });
}
