import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { ClerkProvider } from '@clerk/clerk-react';
import { AuthProvider, CLERK_ENABLED } from './context/AuthContext';
import { TenantProvider } from './context/TenantContext';

// Register PWA Service Worker with immediate auto-update
registerSW({ immediate: true });

const tree = (
  <AuthProvider>
    <TenantProvider>
      <App />
    </TenantProvider>
  </AuthProvider>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {CLERK_ENABLED ? (
      <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string} afterSignOutUrl="/">
        {tree}
      </ClerkProvider>
    ) : (
      tree
    )}
  </StrictMode>
);
