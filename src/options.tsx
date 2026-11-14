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
    {/* Light (校正紙) for the same reason as the popup: the page surfaces are
        hard-coded paper, and the shadcn primitives follow the theme class. */}
    <ThemeProvider defaultTheme='light' storageKey='manga-translator-theme'>
      <OptionsApp />
    </ThemeProvider>
  </React.StrictMode>
);
