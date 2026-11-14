import React from 'react';
import ReactDOM from 'react-dom/client';
import PopupApp from './components/Popup/PopupApp';
import { ThemeProvider } from './components/theme-provider';
import './index.css';

const appRoot = document.getElementById('app');

if (!appRoot) {
  throw new Error('App root element not found');
}

ReactDOM.createRoot(appRoot).render(
  <React.StrictMode>
    {/* One theme: 校正紙. The surfaces are hard-coded paper utilities and the
        shadcn primitives read the same variables; pinning the theme keeps the
        two in step. A stored `dark` from an older build resolves to the
        pinned theme instead of repainting the page. */}
    <ThemeProvider defaultTheme='light' storageKey='manga-translator-theme'>
      <PopupApp />
    </ThemeProvider>
  </React.StrictMode>
);
