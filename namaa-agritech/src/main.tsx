import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from '@/lib/auth';
import { LangProvider } from '@/lib/lang';
import { FieldDataProvider } from '@/lib/field-data';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <AuthProvider>
        <FieldDataProvider>
          <App />
        </FieldDataProvider>
      </AuthProvider>
    </LangProvider>
  </StrictMode>
);
