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
    <ThemeProvider defaultTheme='system' storageKey='manga-translator-theme'>
      <OptionsApp />
    </ThemeProvider>
  </React.StrictMode>
);
