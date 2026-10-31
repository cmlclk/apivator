import { beforeEach, describe, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import {
  emptyAuth,
  emptyBody,
  emptyScripts,
  type CollectionTreeDto,
  type DocumentationDto,
  type ForkInfoDto,
  type MockServerDto,
  type MonitorDto,
  type ProfileDto,
} from '@apivator/core';
import { AccountPage } from '../features/account/AccountPage';
import { VariablesDialog } from '../features/environments/VariablesDialog';
import { ForkStatusDialog } from '../features/forks/ForkStatusDialog';
import { GitPullPanel } from '../features/gitsync/GitPullPanel';
import { DescriptionDialog } from '../features/collections/DescriptionDialog';
import { DocsView } from '../features/docs/DocsView';
import { PublishDialog } from '../features/docs/PublishDialog';
import { HistoryPanel } from '../features/history/HistoryPanel';
import { MocksPanel } from '../features/mocks/MocksPanel';
import { MockDetailDialog } from '../features/mocks/MockDetailDialog';
import { MockSettingsDialog } from '../features/mocks/MockSettingsDialog';
import { MonitorDetailDialog } from '../features/monitors/MonitorDetailDialog';
import { MonitorSettingsDialog } from '../features/monitors/MonitorSettingsDialog';
import { AuthEditor } from '../features/requests/AuthEditor';
import { TestResults } from '../features/requests/TestResults';
import { ResponsePanel } from '../features/requests/ResponsePanel';
import { ConsolePanel } from '../features/console/ConsolePanel';
import { ScriptsEditor } from '../features/scripts/ScriptsEditor';
import { RunnerDialog } from '../features/runner/RunnerDialog';
import { ToolsPage } from '../features/tools/ToolsPage';
import { LoginPage } from '../pages/auth/LoginPage';
import { expectNoUntranslatedText, usePseudoLanguage, type UntranslatedOptions } from './testing/pseudo';

/**
 * Sözde dil ile ekran ekran tarama (Faz 8.4): ana ekranlar `[!! … !!]` diliyle çizilir; düz harf kalan her metin
 * çevrilmemiş ya da koda gömülü demektir. `allow` yalnızca kullanıcı verisi, marka ve teknik terimler içindir
 * (docs/terimler.md: her dilde aynı yazılan terimler).
 */
vi.mock('../lib/api', () => ({
  api: {
    account: { profile: vi.fn() },
    auth: { ssoDiscover: vi.fn() },
    forks: { compare: vi.fn() },
    gitSync: { previewPull: vi.fn(), pull: vi.fn() },
    docs: { publication: vi.fn() },
    monitors: { runs: vi.fn() },
    mocks: { list: vi.fn(), routes: vi.fn(), calls: vi.fn() },
    history: { list: vi.fn() },
    collections: { list: vi.fn() },
    environments: { list: vi.fn() },
    runs: { get: vi.fn(), list: vi.fn() },
  },
}));

vi.mock('../lib/useWorkspaces', () => ({
  useWorkspaces: () => ({ current: { id: 'w1', role: 'Admin' }, workspaces: [] }),
}));

// CodeMirror jsdom'da ölçüm yapamıyor; düz bir metin alanı yeterli.
vi.mock('../features/requests/CodeEditor', () => ({
  CodeEditor: ({ value, label }: { value: string; label: string }) => (
    <textarea aria-label={label} value={value} readOnly />
  ),
}));

const { api } = await import('../lib/api');

/**
 * Her ekranda geçerli olanlar: marka, teknik terimler, `Intl` ile biçimlenen tarihler ve kod örneği dilleri.
 * Ekrana özgü kullanıcı verisi `scan`in ikinci bağımsız değişkenindedir (önce uygulanır, çünkü "Shop API" gibi
 * veriler teknik terimleri içerir).
 */
const COMMON: readonly (string | RegExp)[] = [
  'Apivator',
  /\b(HTTP|HTTPS|JSON|XML|GET|POST|PUT|PATCH|DELETE|URL|API|JWT|OAuth|gRPC|GraphQL|ms|UTC|CSV|YAML|SSO)\b/,
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|\b(AM|PM)\b/,
  /\b(cURL|C# HttpClient|JavaScript fetch|Python requests|Go net\/http|PowerShell)\b/,
  /\{\{\w+\}\}/,
  // Metinlerde anılan HTML etiketleri (ör. `<p>`).
  /<\/?\w+>/,
];

// eslint-disable-next-line react-hooks/rules-of-hooks -- vitest beforeEach/afterEach kancaları, React kancası değil
usePseudoLanguage();

function renderScreen(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Eşzamansız sorgular (mock'lanmış API) bitip ekran oturana kadar bekler. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

const scan = (container: Element, allow: UntranslatedOptions['allow'] = []) =>
  expectNoUntranslatedText(container, { allow: [...allow, ...COMMON] });

const fork = {
  id: 'f1',
  forkCollectionId: 'c2',
  forkName: 'Users API (fork)',
  forkWorkspaceId: 'w1',
  sourceCollectionId: 'c1',
  sourceName: 'Users API',
  sourceWorkspaceId: 'w2',
  sourceWorkspaceName: 'Team',
  createdByName: 'Ada',
  createdAt: '2026-10-22T08:00:00Z',
  lastPulledAt: null,
} as ForkInfoDto;

const monitor = {
  id: 'm1',
  workspaceId: 'w1',
  collectionId: 'c1',
  collectionName: 'Health',
  environmentId: null,
  name: 'Live health',
  schedule: '*/15 * * * *',
  timeZone: 'Europe/Istanbul',
  enabled: true,
  notifyEmails: [],
  webhookUrl: null,
  webhookKind: 'Slack',
  notifyMode: 'Changes',
  createdById: 'u1',
  createdByName: 'Ada',
  nextRunAt: null,
  lastRunAt: null,
  lastRunId: null,
  health: 'Failing',
  consecutiveFailures: 1,
  lastError: null,
  createdAt: '2026-10-20T10:00:00Z',
} as MonitorDto;

const mock = {
  id: 'k1',
  workspaceId: 'w1',
  collectionId: 'c1',
  collectionName: 'Shop',
  environmentId: null,
  name: 'Shop mock',
  path: '/mock/abc',
  isPrivate: true,
  delayMs: 300,
  enabled: true,
} as unknown as MockServerDto;

const doc = {
  collectionId: 'c1',
  name: 'Shop API',
  description: null,
  workspaceName: 'Team',
  auth: { type: 'Bearer', detail: 'Authorization: Bearer <token>', source: null },
  environmentName: 'Test',
  variables: [{ key: 'token', value: '', isSecret: true, source: 'environment' }],
  folders: [],
  requests: [
    {
      id: 'r1',
      folderId: null,
      name: 'Get product',
      sortOrder: 0,
      kind: 'Http',
      method: 'GET',
      url: '/products/1',
      description: '',
      headers: [],
      body: emptyBody(),
      auth: { type: 'Bearer', detail: null, source: 'collection' },
      grpcMethod: null,
      examples: [],
    },
  ],
  updatedAt: '2026-10-22T10:00:00Z',
} as unknown as DocumentationDto;

const collection = {
  id: 'c1',
  workspaceId: 'w1',
  name: 'Shop',
  description: null,
  auth: emptyAuth('None'),
  variables: [],
  scripts: emptyScripts(),
  folders: [],
  requests: [{ id: 'r1', folderId: null, name: 'Get product', method: 'GET', sortOrder: 0 }],
  examples: [],
} as unknown as CollectionTreeDto;

const profile = {
  id: 'u1',
  email: 'ayse@example.com',
  displayName: 'Ayse',
  emailConfirmed: true,
  pendingEmail: null,
  createdAt: '2026-01-15T10:00:00Z',
  avatarVersion: null,
  organizations: [],
} as ProfileDto;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(api.account.profile).mockResolvedValue(profile);
  vi.mocked(api.forks.compare).mockResolvedValue({
    changes: [],
    incoming: 0,
    outgoing: 0,
    conflicts: 0,
  } as never);
  vi.mocked(api.docs.publication).mockResolvedValue(null as never);
  vi.mocked(api.monitors.runs).mockResolvedValue([]);
  vi.mocked(api.mocks.list).mockResolvedValue([mock]);
  vi.mocked(api.history.list).mockResolvedValue([]);
  vi.mocked(api.mocks.routes).mockResolvedValue([]);
  vi.mocked(api.mocks.calls).mockResolvedValue([]);
  vi.mocked(api.collections.list).mockResolvedValue([{ id: 'c1', name: 'Shop' }] as never);
  vi.mocked(api.environments.list).mockResolvedValue([]);
  vi.mocked(api.runs.list).mockResolvedValue([]);
});

describe('sözde dilde ekran taraması', () => {
  it('istek editörü: kimlik doğrulama, betikler, test sonuçları, konsol, yanıt', async () => {
    const { container } = renderScreen(
      <>
        <AuthEditor auth={emptyAuth('Bearer')} allowInherit onChange={() => undefined} />
        <ScriptsEditor value={{ preRequest: '', postResponse: '' }} onChange={() => undefined} />
        <TestResults tests={[]} console={[]} />
        <ConsolePanel />
        <ResponsePanel response={null} sending={false} />
      </>,
    );
    await settle();
    scan(container, [
      /\bBearer\b/,
      'eyJhbGciOi…',
      // Her dilde aynı kalan terimler (docs/terimler.md) ve tuş adları (kbd).
      /\b(Token|Pre-request|Post-response|Ctrl|Enter)\b/,
    ]);
  });

  it('collection, environment, fork ve git ekranları', async () => {
    const { container } = renderScreen(
      <>
        <VariablesDialog
          title="Environment: Dev"
          description="desc"
          name="Dev"
          variables={[{ key: 'token', value: '', enabled: true, isSecret: true }]}
          currentValues={{}}
          onSave={vi.fn()}
          onClose={vi.fn()}
        />
        <DescriptionDialog
          title="Description: A"
          initial=""
          readOnly={false}
          onSave={vi.fn()}
          onClose={vi.fn()}
        />
        <ForkStatusDialog fork={fork} canEdit onClose={vi.fn()} />
        <GitPullPanel collectionId="c1" onDone={vi.fn()} />
      </>,
    );
    await settle();
    scan(container, [
      'Environment: Dev',
      'Description: A',
      'desc',
      'Dev',
      'token',
      'Users API (fork)',
      'Users API',
      'Team',
      'Ada',
    ]);
  });

  it('geçmiş ve mock listesi', async () => {
    const { container } = renderScreen(
      <>
        <HistoryPanel />
        <MocksPanel />
      </>,
    );
    await settle();
    scan(container, ['Shop mock', 'Shop']);
  });

  it('mock ekranları', async () => {
    const { container } = renderScreen(
      <>
        <MockDetailDialog mock={mock} canEdit onClose={vi.fn()} />
        <MockSettingsDialog workspaceId="w1" onSaved={vi.fn()} onClose={vi.fn()} />
      </>,
    );
    await settle();
    scan(container, ['Shop mock', 'Shop', /http:\/\/localhost:3000\/mock\/abc/]);
  });

  it('monitör ekranları', async () => {
    const { container } = renderScreen(
      <>
        <MonitorDetailDialog monitor={monitor} canEdit onClose={vi.fn()} />
        <MonitorSettingsDialog workspaceId="w1" onSaved={vi.fn()} onClose={vi.fn()} />
      </>,
    );
    await settle();
    scan(container, [
      'Live health',
      'Health',
      'Ada',
      'Europe/Istanbul',
      'Shop',
      /\*\/15 \* \* \* \*/,
      'Slack',
      // Microsoft Teams (marka) ve web kancası adresi örneği.
      'Teams',
      /https:\/\/hooks\.slack\.com\/services\/…/,
      // İngilizce cron açıklamasını katalog yerine kod üretir (core/src/tools/cronDescribeEn.ts; dil bilgisi
      // Türkçeden farklı olduğu için ayrı açıklayıcı), sözde dil bunu dönüştüremez.
      /\b(Every|At the top of every hour|day at \d\d:\d\d|weekday at \d\d:\d\d|\d+ (minutes|hours))\b/,
    ]);
  });

  it('hesap ve giriş ekranları', async () => {
    const { container } = renderScreen(
      <>
        <LoginPage />
        <AccountPage />
      </>,
    );
    await settle();
    await screen.findAllByText(/ayse@example.com/);
    // Dil seçicide her dil kendi adıyla görünür.
    scan(container, [
      'Ayse',
      'ayse@example.com',
      'Pseudo',
      'Türkçe',
      'English',
      // Giriş sayfasının süslemesindeki örnek istek yolları ve avatar baş harfi (kullanıcı verisi).
      /\/api\/[\w/{}]+/,
      /^\s*A\s*$/,
    ]);
  });

  it('doküman ekranları', async () => {
    const { container } = renderScreen(
      <>
        <DocsView doc={doc} />
        <PublishDialog
          collectionId="c1"
          collectionName="Shop API"
          environments={[]}
          isAdmin={false}
          canEdit
          onClose={() => {}}
        />
      </>,
    );
    await settle();
    scan(container, [
      'Shop API',
      'Team',
      'Test',
      'Get product',
      '/products/1',
      'token',
      /curl|Authorization: Bearer|-H/,
      /<\/?\w+>/,
      /curl\s+\\\s+\/products\/1\s+\\\s+-H '[^']*'/,
    ]);
  });

  it('runner', async () => {
    const { container } = renderScreen(
      <RunnerDialog workspaceId="w1" collection={collection} folderId={null} onClose={vi.fn()} />,
    );
    await settle();
    scan(container, ['Shop', 'Get product']);
  });

  it('araçlar kataloğu', async () => {
    const { container } = renderScreen(<ToolsPage />);
    await settle();
    scan(container);
  });
});
