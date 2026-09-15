import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource-variable/inter';
import './styles.css';
import App from './App';
import { FinanceProvider } from './state/finance';
import { UIProvider } from './state/ui';

// Service worker só onde o navegador permite (HTTPS/localhost e mesmo host).
if ('serviceWorker' in navigator && window.isSecureContext && window.self === window.top) {
  try {
    registerSW({ immediate: true });
  } catch {
    /* sem modo offline neste ambiente */
  }
}

const Splash = (
  <div className="splash"><img className="splash-mark" src={`${import.meta.env.BASE_URL}icon.svg`} alt="Carregando Meu Futuro" /></div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FinanceProvider fallback={Splash}>
      <UIProvider>
        <App />
      </UIProvider>
    </FinanceProvider>
  </StrictMode>,
);
