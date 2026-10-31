import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';
export default defineConfig({plugins:[react(),VitePWA({
  registerType:'autoUpdate',
  // ملفات الكتب (PDF ونص الكتاب) تُستثنى من التخزين المسبق؛ كبيرة الحجم — تُجلب عند الطلب.
  includeAssets:['icons/app-icon.svg','brand/book-mark.svg','brand/logo-compact.svg','brand/logo-compact-dark.svg','brand/logo-full-vertical.svg','brand/logo-full-horizontal.svg','brand/logo-full-horizontal-dark.svg','books/manifest.json','books/book-text.json'],
  manifest:{
    name:'الربانيون | على هدي الكتاب والسنة',
    short_name:'الربانيون',
    description:'علمٌ نافع، وعملٌ صالح، وقلبٌ خاشع.',
    lang:'ar',
    dir:'rtl',
    theme_color:'#244638',
    background_color:'#E5EBE3',
    display:'standalone',
    icons:[
      {src:'icons/app-icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'},
      {src:'icons/app-icon.svg',sizes:'any',type:'image/svg+xml',purpose:'maskable'},
    ],
  },
})]});
