import React from 'react';
import ReactDOM from 'react-dom/client';
import OptionsApp from './components/Options/OptionsApp';
import { ThemeProvider } from './components/theme-provider';
import './index.css';

const appRoot = document.getElementById('app');

if (!appRoot) {
  throw new Error('App root element not found');
}

ReactDOM.createRoot(appRoot).render(
  <React.StrictMode>
    {/* Dark for the same reason as the popup: the page surfaces are
        hard-coded dark, and the shadcn primitives follow the theme class. */}
    <ThemeProvider defaultTheme='dark' storageKey='manga-translator-theme'>
      <OptionsApp />
    </ThemeProvider>
  </React.StrictMode>
);
