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
    {/* The popup's own surfaces are hard-coded dark (`bg-slate-950`), but the
        shadcn primitives read the semantic CSS variables. Following the
        system theme put a light `bg-input` switch on a dark card — the
        unchecked state measured a 1.26:1 contrast against its own track, so
        the switch looked like a blank line. Pinning the theme to dark keeps
        the two in step. */}
    <ThemeProvider defaultTheme='dark' storageKey='manga-translator-theme'>
      <PopupApp />
    </ThemeProvider>
  </React.StrictMode>
);
