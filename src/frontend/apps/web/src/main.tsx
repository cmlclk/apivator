import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { queryClient } from './lib/queryClient';
import { router } from './router';
import { bootstrapOffline } from './bootstrap';
import { useEnvironmentStore } from './features/environments/environmentStore';
import { isDesktop } from './lib/desktop';
import { initI18n } from './i18n';
import './index.css';

bootstrapOffline();

/**
 * Masaüstünde değişkenlerin güncel değerleri şifreli saklanır ve asenkron çözülür; uygulama değerler yüklenmeden
 * açılmasın (ilk istek boş değerle gitmesin). Anahtar zinciri takılırsa en fazla 3 saniye beklenir.
 */
function variablesReady(): Promise<void> {
  if (!isDesktop() || useEnvironmentStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useEnvironmentStore.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
    setTimeout(resolve, 3000);
  });
}

void Promise.all([variablesReady(), initI18n()]).then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  ),
);
