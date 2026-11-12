import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/theme.css';
import './styles/app.css';
import './styles/phone.css';

// Track the visible viewport height so the app can sit above the on-screen keyboard on phones.
const vv = window.visualViewport;
if (vv) {
  const sync = () => document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
  vv.addEventListener('resize', sync);
  sync();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
