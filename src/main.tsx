import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import './styles.css';
import './day-planner.css';
import './design-system.css';
import './strong-goals.css';
import './brand-identity.css';
import './section-theme.css';
import './premium-theme.css';
import './dark-auto-sweep.css';
// profile.css يحمل أنماط `.user-chip` في الشريط العلوي (شل التطبيق) — لا يجوز
// تركها في chunk كسول لـ ProfileView وإلا ظهر الزر بتنسيق المتصفح الافتراضي.
import './profile.css';
// Must load last: this is the single semantic theme boundary for all shared UI.
import './theme-engine.css';
import {installSectionTheme} from './section-theme';
import {installAppearance} from './appearance';
installSectionTheme();
installAppearance();
createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App/></ErrorBoundary></React.StrictMode>);
