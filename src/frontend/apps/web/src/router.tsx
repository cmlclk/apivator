import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { SessionBoot } from './components/SessionBoot';
import { RouteError } from './components/RouteError';
import { GuestOnly, RequireAuth, TeamOnly } from './components/RouteGuards';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/auth/LoginPage';
import { RequestWorkspace } from './features/requests/RequestWorkspace';

// Giriş ve istek ekranı dışındaki sayfalar ana pakete girmez; ilk açılışta yüklenir.
export const routes: RouteObject[] = [
  // Açılır pencere: oturum açılışını (SessionBoot) beklemeden kodu iletir.
  {
    path: '/oauth/callback',
    lazy: () => import('./pages/OAuthCallbackPage').then((m) => ({ Component: m.OAuthCallbackPage })),
    errorElement: <RouteError />,
  },
  // Kimlik sağlayıcıdan dönüş: giriş kodunu kendisi oturuma çevirir, açılış yenilemesiyle yarışmasın.
  {
    path: '/sso/callback',
    lazy: () => import('./pages/auth/SsoCallbackPage').then((m) => ({ Component: m.SsoCallbackPage })),
    errorElement: <RouteError />,
  },
  {
    path: '/sso/link',
    lazy: () => import('./pages/auth/SsoLinkPage').then((m) => ({ Component: m.SsoLinkPage })),
    errorElement: <RouteError />,
  },
  {
    element: <SessionBoot />,
    errorElement: <RouteError />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          { path: '/login', element: <LoginPage /> },
          {
            path: '/register',
            lazy: () => import('./pages/auth/RegisterPage').then((m) => ({ Component: m.RegisterPage })),
          },
          {
            path: '/forgot-password',
            lazy: () =>
              import('./pages/auth/ForgotPasswordPage').then((m) => ({ Component: m.ForgotPasswordPage })),
          },
          {
            path: '/reset-password',
            lazy: () =>
              import('./pages/auth/ResetPasswordPage').then((m) => ({ Component: m.ResetPasswordPage })),
          },
        ],
      },
      {
        path: '/confirm-email',
        lazy: () => import('./pages/auth/ConfirmEmailPage').then((m) => ({ Component: m.ConfirmEmailPage })),
      },
      // Hesap e-postalarındaki bağlantılar: oturum gerekmez (başka bir tarayıcıda açılabilir).
      {
        path: '/confirm-email-change',
        lazy: () =>
          import('./pages/auth/ConfirmEmailChangePage').then((m) => ({
            Component: m.ConfirmEmailChangePage,
          })),
      },
      {
        path: '/delete-account',
        lazy: () =>
          import('./pages/auth/DeleteAccountPage').then((m) => ({ Component: m.DeleteAccountPage })),
      },
      // Davet bağlantısı: oturum yoksa davet gösterilir, giriş/kayıt sonrası buraya dönülür.
      {
        element: <TeamOnly />,
        children: [
          {
            path: '/invite',
            lazy: () => import('./pages/InvitePage').then((m) => ({ Component: m.InvitePage })),
          },
        ],
      },
      // Yayınlanmış doküman: herkese açık olanlar oturumsuz açılır (sayfa kendisi karar verir).
      {
        path: '/docs/:slug',
        lazy: () =>
          import('./features/docs/PublishedDocsPage').then((m) => ({ Component: m.PublishedDocsPage })),
      },
      {
        element: <RequireAuth />,
        children: [
          {
            path: '/',
            element: <AppShell />,
            children: [
              { index: true, element: <RequestWorkspace /> },
              {
                element: <TeamOnly />,
                children: [
                  {
                    path: 'team',
                    lazy: () => import('./pages/TeamPage').then((m) => ({ Component: m.TeamPage })),
                  },
                ],
              },
              {
                path: 'account',
                lazy: () =>
                  import('./features/account/AccountPage').then((m) => ({ Component: m.AccountPage })),
              },
              {
                path: 'tools/:toolId?',
                lazy: () => import('./features/tools/ToolsPage').then((m) => ({ Component: m.ToolsPage })),
              },
              {
                path: 'collections/:collectionId/docs',
                lazy: () =>
                  import('./features/docs/CollectionDocsPage').then((m) => ({
                    Component: m.CollectionDocsPage,
                  })),
              },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
