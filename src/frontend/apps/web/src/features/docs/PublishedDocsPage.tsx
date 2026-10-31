import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@apivator/core';
import { Spinner } from '@apivator/ui';
import { api } from '../../lib/api';
import { useLocale, useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { Logo } from '../../components/Logo';
import { LanguageSelect } from '../../components/LanguageSelect';
import { ThemeToggle } from '../../components/ThemeToggle';
import { useSession } from '../../stores/session';
import { DocsView } from './DocsView';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-bg p-8 text-center">
      <Logo className="h-10 w-10" />
      {children}
    </div>
  );
}

/** Yayınlanmış doküman: /docs/{slug}. Herkese açık olanlar oturumsuz, organizasyon içi olanlar oturumla açılır. */
export function PublishedDocsPage() {
  const t = useT('docs');
  const { slug = '' } = useParams();
  const signedIn = useSession((s) => s.status === 'authenticated');
  // Yetkilendirme özeti gibi metinler sunucuda isteğin dilinde üretilir; dil değişince yeniden alınır.
  const language = useLocale((s) => s.language);
  const {
    data: doc,
    error,
    isLoading,
  } = useQuery({
    queryKey: ['published-docs', slug, signedIn, language],
    placeholderData: (previous) => previous,
    queryFn: () => api.docs.published(slug),
    retry: false,
  });

  if (isLoading) {
    return (
      <Centered>
        <Spinner className="h-5 w-5" />
      </Centered>
    );
  }

  if (!doc) {
    const loginRequired = error instanceof ApiError && error.status === 401;
    return (
      <Centered>
        {loginRequired ? (
          <>
            <h1 className="text-lg font-semibold">{t('published.loginRequiredTitle')}</h1>
            <p className="max-w-sm text-sm text-fg-muted">{t('published.loginRequiredBody')}</p>
            <Link
              to={`/login?redirect=${encodeURIComponent(`/docs/${slug}`)}`}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              {t('published.signIn')}
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">{t('published.notFoundTitle')}</h1>
            <p className="max-w-sm text-sm text-fg-muted">
              {error instanceof ApiError && error.status === 404
                ? t('published.notFoundBody')
                : errorMessage(error)}
            </p>
          </>
        )}
      </Centered>
    );
  }

  return (
    <div className="h-full">
      <DocsView
        doc={doc}
        toolbar={
          <>
            <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <Logo className="h-4 w-4" /> {t('published.publishedWith')}
            </span>
            <LanguageSelect compact />
            <ThemeToggle />
          </>
        }
      />
    </div>
  );
}
