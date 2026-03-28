import React from 'react';
import ReactDOM from 'react-dom/client';
import OptionsApp from './components/Options/OptionsApp';
import { ThemeProvider } from './components/theme-provider';
import './index.css';

const optionsRoot = document.getElementById('app');

if (!optionsRoot) {
  throw new Error('Options root element not found');
}

ReactDOM.createRoot(optionsRoot).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="manga-translator-theme">
      <OptionsApp />
    </ThemeProvider>
  </React.StrictMode>,
);
