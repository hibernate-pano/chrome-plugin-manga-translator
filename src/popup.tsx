import React from 'react';
import ReactDOM from 'react-dom/client';
import SimplePopupApp from './components/Popup/SimplePopupApp';
import { ThemeProvider } from './components/theme-provider';
import './index.css';

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="manga-translator-theme">
      <SimplePopupApp />
    </ThemeProvider>
  </React.StrictMode>,
);
