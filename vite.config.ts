import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';
export default defineConfig({plugins:[react(),VitePWA({
  registerType:'autoUpdate',
  // ملفات الكتب (PDF ونص الكتاب) تُستثنى من التخزين المسبق؛ كبيرة الحجم — تُجلب عند الطلب.
  includeAssets:['icons/app-icon.svg','books/manifest.json','books/book-text.json'],
  manifest:{
    name:'الربانيون | مسيرة العلم والعمل',
    short_name:'الربانيون',
    description:'علمٌ يُثمر إيمانًا، وإيمانٌ يُثمر عملًا',
    lang:'ar',
    dir:'rtl',
    theme_color:'#293a30',
    background_color:'#e8ede6',
    display:'standalone',
    icons:[
      {src:'icons/app-icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'},
      {src:'icons/app-icon.svg',sizes:'any',type:'image/svg+xml',purpose:'maskable'},
    ],
  },
})]});
