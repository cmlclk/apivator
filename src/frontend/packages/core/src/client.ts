import { coreLanguage, msg } from './i18n';
import { AgentError, ApiError, NetworkError } from './errors';
import { createGitSyncApi } from './gitsync';
import { auditQuery, type AuditFilter, type AuditPageDto } from './audit';
import type {
  SsoDiscoveryDto,
  SsoSettingsDto,
  SsoStartRequest,
  SsoStateRequest,
  UpdateSsoRequest,
} from './sso';
import type {
  ApiRequestDto,
  AuthResult,
  RunDetailDto,
  RunEvent,
  RunSummaryDto,
  StartRunRequest,
  OrganizationDto,
  OrganizationMembersDto,
  OrganizationRole,
  InvitationDto,
  InviteRequest,
  InvitationPreviewDto,
  MyInvitationDto,
  AcceptedInvitationDto,
  TeamDto,
  WorkspaceMembersDto,
  WorkspaceRole,
  LocalRunReport,
  RunReportRequest,
  RunResultEntry,
  RunSourceDto,
  OAuth2TokenDto,
  OAuth2TokenRequest,
  GrpcDescribeRequest,
  DocPublicationDto,
  DocumentationDto,
  DocVisibility,
  GrpcSchemaDto,
  CreateExampleRequest,
  ExampleDto,
  DownloadedFile,
  HistoryEntryDto,
  HistoryResponseDto,
  ImportResult,
  RecoveryCodesDto,
  SecurityEventDto,
  TwoFactorChallenge,
  TwoFactorSetupDto,
  TwoFactorStatusDto,
  KeyValueItem,
  CollectionSourceDto,
  SourceApplyResult,
  SourceDiffDto,
  SpecFetchResult,
  UrlImportResponse,
  RecordHistoryRequest,
  CollectionTreeDto,
  EnvironmentDto,
  ExecuteRequest,
  ExecuteResponse,
  FolderDto,
  GlobalsDto,
  LoginRequest,
  RegisterRequest,
  RequestAuth,
  RequestDefinition,
  ScriptSet,
  Variable,
  ResetPasswordRequest,
  UserDto,
  WorkspaceDto,
  ActivityPage,
  ApiKeyDto,
  CreatedApiKeyDto,
  MockCallDto,
  ForkComparisonDto,
  ForkInfoDto,
  MergeRequestDetailDto,
  MergeRequestDto,
  MergeRequestStatus,
  MonitorDto,
  MonitorRunPointDto,
  MonitorSettings,
  MockRouteDto,
  MockServerDto,
  MockSettings,
  CommentCountDto,
  CommentDto,
  CommentTarget,
  EnvironmentSnapshot,
  NotificationsDto,
  PersonDto,
  RequestSnapshot,
  VersionDto,
  StreamEvent,
  CollectionAccessDto,
  CollectionAccessInput,
  AccountDeletionCheckDto,
  ChangePasswordRequest,
  PreferencesDto,
  ProfileDto,
  SessionDto,
} from './types';

/** Masaüstü uygulamasının yerel yürütme ajanı (127.0.0.1 üzerinde, oturum token'ıyla korunur). */
export interface LocalAgent {
  url: string;
  token: string;
}

export const AGENT_TOKEN_HEADER = 'X-Apivator-Agent-Token';

/** Refresh token'ın cookie yerine saklandığı yer (masaüstünde işletim sisteminin anahtar zinciri). */
export interface RefreshTokenStore {
  get: () => Promise<string | null>;
  set: (token: string | null) => Promise<void>;
}

export interface ApiClientOptions {
  /** API kök adresi. Web'de boş bırakılır (aynı origin, `/api` proxy'lenir); masaüstünde ayarlanabilir. */
  baseUrl?: string | (() => string);
  /** Verilirse istekler (execute, OAuth token) sunucu yerine bu yerel ajan üzerinden yürütülür. */
  localAgent?: () => Promise<LocalAgent>;
  refreshTokens?: RefreshTokenStore;
  /**
   * Oturumun refresh yerine alındığı yer (masaüstü yerel modu: token uygulamadan gelir, giriş yok). `null` dönerse
   * normal refresh yapılır; karar her yenilemede verilir.
   */
  sessionSource?: () => Promise<AuthResult | null> | null;
  getAccessToken: () => string | null;
  /** Yenilenen oturumu saklar; yenileme başarısızsa `null` ile çağrılır. */
  onSession: (session: AuthResult | null) => void;
  fetch?: typeof fetch;
  /** Bu sekmenin kimliği; canlı kanalda kendi değişikliklerini tanımak için her isteğe eklenir. */
  clientId?: string;
  /**
   * Sunucuya ulaşılıp ulaşılamadığını bildirir: ağ hatasında false, herhangi bir yanıtta true. Çevrimdışı mod
   * bununla açılıp kapanır.
   */
  onReachability?: (reachable: boolean) => void;
  /**
   * İstemci türü ("desktop", "cli"); sunucu oturum listesinde cihazı buna göre adlandırır. Web'de boş bırakılır.
   */
  app?: string;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** JSON yerine ham gövde (ör. görsel yükleme); içerik türü Blob'dan alınır. */
  raw?: Blob;
  signal?: AbortSignal;
  /** 401'de refresh denenmesin (auth uçları için). */
  skipRefresh?: boolean;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** JWT'nin süresi (30 sn pay ile) dolmuş mu? Okunamazsa dolmamış sayılır; sunucu karar verir. */
function tokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + 30_000;
  } catch {
    return false;
  }
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = () => (typeof options.baseUrl === 'function' ? options.baseUrl() : (options.baseUrl ?? ''));
  const store = options.refreshTokens;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  let refreshing: Promise<AuthResult | null> | null = null;

  async function send(path: string, init: RequestOptions): Promise<Response> {
    // Sunucunun hata ve doğrulama mesajları arayüzün etkin dilinde gelir (Faz 8.2).
    const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': coreLanguage() };
    if (init.raw) headers['Content-Type'] = init.raw.type || 'application/octet-stream';
    else if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.app) headers['X-Apivator-App'] = options.app;

    const token = options.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.clientId) headers['X-Apivator-Client'] = options.clientId;

    try {
      const response = await doFetch(`${baseUrl()}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
        credentials: 'include',
        signal: init.signal,
      });
      // Ters proxy sunucuya ulaşamıyorsa (502/503/504) sunucu da ulaşılamaz sayılır.
      options.onReachability?.(response.status < 502 || response.status > 504);
      return response;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      options.onReachability?.(false);
      throw new NetworkError(error);
    }
  }

  /** Aynı anda gelen 401'ler tek bir refresh isteğini paylaşır. */
  function refreshSession(): Promise<AuthResult | null> {
    refreshing ??= (async () => {
      try {
        const custom = options.sessionSource?.();
        if (custom) {
          const session = await custom;
          options.onSession(session);
          return session;
        }
        const stored = store ? await store.get() : null;
        if (store && !stored) {
          options.onSession(null);
          return null;
        }
        const response = await send('/api/auth/refresh', {
          method: 'POST',
          body: stored ? { refreshToken: stored } : {},
        });
        if (response.status >= 502 && response.status <= 504) throw new NetworkError(response.statusText);
        const session = response.ok ? ((await response.json()) as AuthResult) : null;
        // Sunucu token'ı reddettiyse silinir; ağ hatasında saklı kalır (sunucuya sonra ulaşılabilir).
        await store?.set(session?.refreshToken ?? null);
        options.onSession(session);
        return session;
      } catch (error) {
        // Sunucuya ulaşılamadıysa oturum kapatılmaz: uygulama çevrimdışı moda geçer (onReachability false),
        // bağlantı gelince yeniden denenir.
        if (!(error instanceof NetworkError) || !options.onReachability) options.onSession(null);
        return null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    let response = await send(path, init);

    if (response.status === 401 && !init.skipRefresh && options.getAccessToken()) {
      const session = await refreshSession();
      if (session) response = await send(path, init);
    }

    if (!response.ok) throw await ApiError.fromResponse(response);
    if (response.status === 204 || response.status === 202) return undefined as T;

    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Dosya indirir; adı Content-Disposition başlığından alır. */
  async function download(path: string, fallbackName: string): Promise<DownloadedFile> {
    let response = await send(path, {});
    if (response.status === 401 && options.getAccessToken()) {
      const session = await refreshSession();
      if (session) response = await send(path, {});
    }
    if (!response.ok) throw await ApiError.fromResponse(response);
    return {
      blob: await response.blob(),
      fileName: fileNameFrom(response.headers.get('Content-Disposition')) ?? fallbackName,
    };
  }

  /**
   * NDJSON akışı: her satır bir olay olarak onEvent'e verilir. signal ile durdurulabilir (sunucu çalıştırmayı keser).
   */
  async function stream<T>(path: string, body: unknown, onEvent: (event: T) => void, signal?: AbortSignal) {
    let response = await send(path, { method: 'POST', body, signal });
    if (response.status === 401 && options.getAccessToken()) {
      const session = await refreshSession();
      if (session) response = await send(path, { method: 'POST', body, signal });
    }
    if (!response.ok) throw await ApiError.fromResponse(response);
    await readLines(response, onEvent);
  }

  /** NDJSON gövdesini satır satır olay olarak okur. */
  async function readLines<T>(response: Response, onEvent: (event: T) => void) {
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) onEvent(JSON.parse(line) as T);
        newline = buffer.indexOf('\n');
      }
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer) as T);
  }

  /** Giriş/kayıt sonrası refresh token'ı (varsa) depoya yazar. */
  async function keep(result: AuthResult): Promise<AuthResult> {
    await store?.set(result.refreshToken);
    return result;
  }

  async function logout(): Promise<void> {
    const stored = store ? await store.get() : null;
    try {
      await request<void>('/api/auth/logout', {
        method: 'POST',
        body: stored ? { refreshToken: stored } : {},
        skipRefresh: true,
      });
    } finally {
      await store?.set(null);
    }
  }

  /** Yerel ajana istek; ajana ulaşılamazsa AgentError, ajan hata dönerse ApiError. */
  async function agent<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    return (await (await agentFetch(path, init)).json()) as T;
  }

  async function agentFetch(
    path: string,
    init: { method?: string; body?: unknown; signal?: AbortSignal },
  ): Promise<Response> {
    let local: LocalAgent;
    try {
      local = await options.localAgent!();
    } catch (error) {
      throw new AgentError(
        msg('core.client.agentNotRunning', 'Yerel yürütme ajanı çalışmıyor: {reason}', {
          reason: error instanceof Error ? error.message : String(error),
        }),
        error,
      );
    }
    let response: Response;
    try {
      response = await doFetch(`${local.url}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Language': coreLanguage(),
          [AGENT_TOKEN_HEADER]: local.token,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new AgentError(
        msg(
          'core.client.agentUnreachable',
          'Yerel yürütme ajanına ulaşılamadı. Uygulamayı yeniden başlatmayı deneyin.',
        ),
        error,
      );
    }
    if (!response.ok) throw await ApiError.fromResponse(response);
    return response;
  }

  /**
   * Masaüstü runner'ı: collection sunucudan alınır, ajanda (bu bilgisayarda) çalışır, rapor sunucuya kaydedilir.
   * Durdurulursa o ana kadarki sonuçlar "Stopped" olarak kaydedilir. Olaylar sunucudaki runner'la aynıdır.
   */
  async function runLocally(body: StartRunRequest, onEvent: (event: RunEvent) => void, signal?: AbortSignal) {
    const source = await request<RunSourceDto>(`/api/collections/${body.collectionId}/run-source`);
    const folder = body.folderId ? source.folders.find((f) => f.id === body.folderId) : undefined;
    const startedAt = new Date().toISOString();
    const results: RunResultEntry[] = [];
    let iterations = body.iterations ?? 1;
    let done: RunEvent | null = null;

    const save = (report: LocalRunReport) =>
      request<RunSummaryDto>('/api/runs/report', {
        method: 'POST',
        body: {
          ...report,
          collectionId: body.collectionId,
          folderId: body.folderId ?? null,
          environmentName: body.variables?.environmentName ?? null,
          delayMs: body.delayMs ?? 0,
        } satisfies RunReportRequest,
      });

    try {
      const response = await agentFetch('/runs', { method: 'POST', body: { run: body, source }, signal });
      await readLines<RunEvent>(response, (event) => {
        if (event.type === 'start') iterations = event.iterations ?? iterations;
        if (event.type === 'result' && event.result) results.push(event.result);
        if (event.type === 'done') done = event;
        else onEvent(event);
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        await save({
          name: folder ? `${source.name} / ${folder.name}` : source.name,
          iterations,
          status: 'Stopped',
          startedAt,
          finishedAt: new Date().toISOString(),
          results,
        }).catch(() => undefined);
      }
      throw error;
    }

    const finished = done as RunEvent | null;
    if (!finished?.report)
      throw new AgentError(
        msg('core.client.agentClosed', 'Yerel ajan çalıştırmayı tamamlamadan bağlantıyı kapattı.'),
      );
    const summary = await save(finished.report);
    onEvent({
      type: 'done',
      runId: summary.id,
      summary,
      variables: finished.variables,
      message: finished.message,
    });
  }

  return {
    request,
    refreshSession,
    /** Masaüstünde istekler yerel ajan üzerinden mi yürütülüyor? */
    local: !!options.localAgent,
    agent: {
      /** Sistem tarayıcısında OAuth girişi: ajan bu state için loopback dönüş adresi açar. */
      startOAuth: (state: string) =>
        agent<{ redirectUri: string }>('/oauth/sessions', { method: 'POST', body: { state } }),
      oauthResult: (state: string) =>
        agent<OAuthLoopbackResult>(`/oauth/sessions/${encodeURIComponent(state)}`),
    },
    auth: {
      register: async (body: RegisterRequest) =>
        keep(await request<AuthResult>('/api/auth/register', { method: 'POST', body, skipRefresh: true })),
      /** İki adımlı doğrulama açıksa oturum yerine TwoFactorChallenge döner; ardından loginTwoFactor. */
      login: async (body: LoginRequest): Promise<AuthResult | TwoFactorChallenge> => {
        const result = await request<AuthResult | TwoFactorChallenge>('/api/auth/login', {
          method: 'POST',
          body,
          skipRefresh: true,
        });
        return 'twoFactorRequired' in result ? result : keep(result);
      },
      /** Authenticator kodu ya da yedek kod. */
      loginTwoFactor: async (challengeToken: string, code: string) =>
        keep(
          await request<AuthResult>('/api/auth/login/2fa', {
            method: 'POST',
            body: { challengeToken, code },
            skipRefresh: true,
          }),
        ),
      logout,
      ssoDiscover: (email: string) =>
        request<SsoDiscoveryDto>(`/api/auth/sso/discover?email=${encodeURIComponent(email)}`, {
          skipRefresh: true,
        }),
      ssoStart: (body: SsoStartRequest) =>
        request<{ authorizationUrl: string }>('/api/auth/sso/start', {
          method: 'POST',
          body,
          skipRefresh: true,
        }),
      /** Tek kullanımlık giriş kodunu oturuma çevirir (masaüstünde refresh token anahtar zincirine yazılır). */
      ssoExchange: async (code: string, codeVerifier: string) =>
        keep(
          await request<AuthResult>('/api/auth/sso/exchange', {
            method: 'POST',
            body: { code, codeVerifier },
            skipRefresh: true,
          }),
        ),
      /** E-postadaki hesap bağlama bağlantısı: hesabı SSO kimliğine bağlar; oturum açmaz (ardından SSO ile girilir). */
      ssoLink: (token: string) =>
        request<void>('/api/auth/sso/link', { method: 'POST', body: { token }, skipRefresh: true }),
      confirmEmail: (userId: string, token: string) =>
        request<void>('/api/auth/confirm-email', {
          method: 'POST',
          body: { userId, token },
          skipRefresh: true,
        }),
      resendConfirmation: () => request<void>('/api/auth/resend-confirmation', { method: 'POST' }),
      forgotPassword: (email: string) =>
        request<void>('/api/auth/forgot-password', { method: 'POST', body: { email }, skipRefresh: true }),
      resetPassword: (body: ResetPasswordRequest) =>
        request<void>('/api/auth/reset-password', { method: 'POST', body, skipRefresh: true }),
    },
    me: () => request<UserDto>('/api/me'),
    account: {
      twoFactor: {
        status: () => request<TwoFactorStatusDto>('/api/me/2fa'),
        setup: () => request<TwoFactorSetupDto>('/api/me/2fa/setup', { method: 'POST' }),
        enable: (code: string) =>
          request<RecoveryCodesDto>('/api/me/2fa/enable', { method: 'POST', body: { code } }),
        disable: (password: string, code: string) =>
          request<void>('/api/me/2fa/disable', { method: 'POST', body: { password, code } }),
        regenerateRecoveryCodes: (code: string) =>
          request<RecoveryCodesDto>('/api/me/2fa/recovery-codes', { method: 'POST', body: { code } }),
      },
      securityEvents: () => request<SecurityEventDto[]>('/api/me/security-events'),
      profile: () => request<ProfileDto>('/api/me/profile'),
      updateProfile: (displayName: string) =>
        request<ProfileDto>('/api/me/profile', { method: 'PATCH', body: { displayName } }),
      /** Görsel (PNG, JPEG, WebP; en fazla 512 KB); yeni sürümü döner. */
      setAvatar: (image: Blob) =>
        request<{ avatarVersion: number }>('/api/me/avatar', { method: 'PUT', raw: image }),
      removeAvatar: () => request<void>('/api/me/avatar', { method: 'DELETE' }),
      /** Yeni adrese doğrulama bağlantısı gider; doğrulanana kadar eski adres geçerlidir. */
      changeEmail: (newEmail: string, password: string) =>
        request<void>('/api/me/email', { method: 'POST', body: { newEmail, password } }),
      cancelEmailChange: () => request<void>('/api/me/email/pending', { method: 'DELETE' }),
      /** E-postadaki bağlantıdan; oturum gerekmez. */
      confirmEmailChange: (userId: string, email: string, token: string) =>
        request<void>('/api/auth/confirm-email-change', {
          method: 'POST',
          body: { userId, email, token },
          skipRefresh: true,
        }),
      /** Bu oturum dışındakiler kapanır. */
      changePassword: (body: ChangePasswordRequest) =>
        request<void>('/api/me/password', { method: 'POST', body }),
      sessions: () => request<SessionDto[]>('/api/me/sessions'),
      revokeSession: (id: string) => request<void>(`/api/me/sessions/${id}`, { method: 'DELETE' }),
      revokeOtherSessions: () =>
        request<{ revoked: number }>('/api/me/sessions/revoke-others', { method: 'POST' }),
      preferences: () => request<PreferencesDto>('/api/me/preferences'),
      updatePreferences: (body: PreferencesDto) =>
        request<PreferencesDto>('/api/me/preferences', { method: 'PUT', body }),
      /** Hesap bilgileri ve kişisel workspace (Postman formatında) tek ZIP. */
      exportData: () => download('/api/me/export', 'apivator-hesap.zip'),
      deletionCheck: () => request<AccountDeletionCheckDto>('/api/me/deletion'),
      /** Şifreyi doğrular, onay bağlantısını e-postayla gönderir. */
      requestDeletion: (password: string) =>
        request<void>('/api/me/deletion', { method: 'POST', body: { password } }),
      /** E-postadaki bağlantıdan; oturum gerekmez. */
      confirmDeletion: (userId: string, token: string) =>
        request<void>('/api/auth/delete-account', {
          method: 'POST',
          body: { userId, token },
          skipRefresh: true,
        }),
    },
    workspaces: {
      list: () => request<WorkspaceDto[]>('/api/workspaces'),
      create: (organizationId: string, name: string) =>
        request<WorkspaceDto>(`/api/organizations/${organizationId}/workspaces`, {
          method: 'POST',
          body: { name },
        }),
      rename: (id: string, name: string) =>
        request<void>(`/api/workspaces/${id}`, { method: 'PATCH', body: { name } }),
      remove: (id: string) => request<void>(`/api/workspaces/${id}`, { method: 'DELETE' }),
      members: (id: string) => request<WorkspaceMembersDto>(`/api/workspaces/${id}/members`),
      setUserRole: (id: string, userId: string, role: WorkspaceRole) =>
        request<void>(`/api/workspaces/${id}/members/users/${userId}`, { method: 'PUT', body: { role } }),
      removeUser: (id: string, userId: string) =>
        request<void>(`/api/workspaces/${id}/members/users/${userId}`, { method: 'DELETE' }),
      setTeamRole: (id: string, teamId: string, role: WorkspaceRole) =>
        request<void>(`/api/workspaces/${id}/members/teams/${teamId}`, { method: 'PUT', body: { role } }),
      removeTeam: (id: string, teamId: string) =>
        request<void>(`/api/workspaces/${id}/members/teams/${teamId}`, { method: 'DELETE' }),
    },
    organizations: {
      list: () => request<OrganizationDto[]>('/api/organizations'),
      /** Zorunlu kılmak için yöneticinin kendi iki adımlı doğrulaması açık olmalı. */
      setSecurity: (id: string, requireTwoFactor: boolean) =>
        request<void>(`/api/organizations/${id}/security`, { method: 'PUT', body: { requireTwoFactor } }),
      /** Organizasyonun varsayılan dili (yalnızca yöneticiler). */
      setLanguage: (id: string, language: string) =>
        request<void>(`/api/organizations/${id}/language`, { method: 'PUT', body: { language } }),
      revokeMemberSessions: (id: string, userId: string) =>
        request<void>(`/api/organizations/${id}/members/${userId}/revoke-sessions`, { method: 'POST' }),
      audit: (id: string, filter: AuditFilter = {}, cursor?: string) =>
        request<AuditPageDto>(`/api/organizations/${id}/audit${auditQuery(filter, { cursor, limit: '50' })}`),
      /** CSV'de ayırıcı ';' (Türkçe Excel); JSON SIEM araçları için. */
      exportAudit: (id: string, format: 'csv' | 'json', filter: AuditFilter = {}) =>
        download(
          `/api/organizations/${id}/audit/export${auditQuery(filter, { format })}`,
          `denetim-kaydi.${format}`,
        ),
      sso: {
        get: (id: string) => request<SsoSettingsDto>(`/api/organizations/${id}/sso`),
        update: (id: string, body: UpdateSsoRequest) =>
          request<SsoSettingsDto>(`/api/organizations/${id}/sso`, { method: 'PUT', body }),
        setState: (id: string, body: SsoStateRequest) =>
          request<SsoSettingsDto>(`/api/organizations/${id}/sso/state`, { method: 'PUT', body }),
        addDomain: (id: string, domain: string) =>
          request<SsoSettingsDto>(`/api/organizations/${id}/sso/domains`, {
            method: 'POST',
            body: { domain },
          }),
        verifyDomain: (id: string, domainId: string) =>
          request<SsoSettingsDto>(`/api/organizations/${id}/sso/domains/${domainId}/verify`, {
            method: 'POST',
          }),
        removeDomain: (id: string, domainId: string) =>
          request<SsoSettingsDto>(`/api/organizations/${id}/sso/domains/${domainId}`, { method: 'DELETE' }),
      },
      sendMemberPasswordReset: (id: string, userId: string) =>
        request<void>(`/api/organizations/${id}/members/${userId}/password-reset`, { method: 'POST' }),
      create: (name: string) =>
        request<OrganizationDto>('/api/organizations', { method: 'POST', body: { name } }),
      rename: (id: string, name: string) =>
        request<void>(`/api/organizations/${id}`, { method: 'PATCH', body: { name } }),
      members: (id: string) => request<OrganizationMembersDto>(`/api/organizations/${id}/members`),
      /** "Owner" verilirse sahiplik devredilir. */
      changeRole: (id: string, userId: string, role: OrganizationRole) =>
        request<void>(`/api/organizations/${id}/members/${userId}`, { method: 'PATCH', body: { role } }),
      removeMember: (id: string, userId: string) =>
        request<void>(`/api/organizations/${id}/members/${userId}`, { method: 'DELETE' }),
      invite: (id: string, body: InviteRequest) =>
        request<InvitationDto>(`/api/organizations/${id}/invitations`, { method: 'POST', body }),
      teams: (id: string) => request<TeamDto[]>(`/api/organizations/${id}/teams`),
      createTeam: (id: string, name: string) =>
        request<TeamDto>(`/api/organizations/${id}/teams`, { method: 'POST', body: { name } }),
    },
    teams: {
      rename: (id: string, name: string) =>
        request<void>(`/api/teams/${id}`, { method: 'PATCH', body: { name } }),
      remove: (id: string) => request<void>(`/api/teams/${id}`, { method: 'DELETE' }),
      addMember: (id: string, userId: string) =>
        request<TeamDto>(`/api/teams/${id}/members`, { method: 'POST', body: { userId } }),
      removeMember: (id: string, userId: string) =>
        request<TeamDto>(`/api/teams/${id}/members/${userId}`, { method: 'DELETE' }),
    },
    invitations: {
      /** Oturum gerekmez: e-postadaki bağlantıyı açan herkes görebilir. */
      preview: (token: string) =>
        request<InvitationPreviewDto>(`/api/invitations/preview?token=${encodeURIComponent(token)}`, {
          skipRefresh: true,
        }),
      accept: (token: string) =>
        request<AcceptedInvitationDto>('/api/invitations/accept', { method: 'POST', body: { token } }),
      acceptById: (id: string) =>
        request<AcceptedInvitationDto>(`/api/invitations/${id}/accept`, { method: 'POST' }),
      resend: (id: string) => request<InvitationDto>(`/api/invitations/${id}/resend`, { method: 'POST' }),
      revoke: (id: string) => request<void>(`/api/invitations/${id}`, { method: 'DELETE' }),
      mine: () => request<MyInvitationDto[]>('/api/me/invitations'),
    },
    collections: {
      list: (workspaceId: string) =>
        request<CollectionTreeDto[]>(`/api/workspaces/${workspaceId}/collections`),
      access: (id: string) => request<CollectionAccessDto>(`/api/collections/${id}/access`),
      updateAccess: (id: string, editingRestricted: boolean, entries: CollectionAccessInput[]) =>
        request<CollectionAccessDto>(`/api/collections/${id}/access`, {
          method: 'PUT',
          body: { editingRestricted, entries },
        }),
      create: (workspaceId: string, name: string) =>
        request<CollectionTreeDto>(`/api/workspaces/${workspaceId}/collections`, {
          method: 'POST',
          body: { name },
        }),
      update: (
        id: string,
        changes: {
          name?: string;
          description?: string;
          auth?: RequestAuth;
          variables?: Variable[];
          scripts?: ScriptSet;
        },
      ) => request<CollectionTreeDto>(`/api/collections/${id}`, { method: 'PATCH', body: changes }),
      remove: (id: string) => request<void>(`/api/collections/${id}`, { method: 'DELETE' }),
      duplicate: (id: string) =>
        request<CollectionTreeDto>(`/api/collections/${id}/duplicate`, { method: 'POST', body: {} }),
      /** Başka bir workspace'e kopya (kaynakta görme, hedefte düzenleme yetkisi gerekir). */
      copyTo: (id: string, workspaceId: string) =>
        request<CollectionTreeDto>(`/api/collections/${id}/duplicate`, {
          method: 'POST',
          body: { workspaceId },
        }),
      /** Başka bir workspace'e taşır (iki tarafta da düzenleme yetkisi gerekir). */
      moveTo: (id: string, workspaceId: string) =>
        request<CollectionTreeDto>(`/api/collections/${id}/move`, { method: 'POST', body: { workspaceId } }),
    },
    folders: {
      create: (collectionId: string, name: string, parentFolderId: string | null) =>
        request<FolderDto>(`/api/collections/${collectionId}/folders`, {
          method: 'POST',
          body: { name, parentFolderId },
        }),
      update: (
        id: string,
        changes: { name?: string; auth?: RequestAuth; scripts?: ScriptSet; description?: string },
      ) => request<FolderDto>(`/api/folders/${id}`, { method: 'PATCH', body: changes }),
      remove: (id: string) => request<void>(`/api/folders/${id}`, { method: 'DELETE' }),
      /** sortOrder: hedefteki kardeş klasörler arasındaki yeni sıra. */
      move: (id: string, parentFolderId: string | null, sortOrder: number, collectionId?: string) =>
        request<FolderDto>(`/api/folders/${id}/move`, {
          method: 'POST',
          body: { parentFolderId, sortOrder, collectionId: collectionId ?? null },
        }),
      duplicate: (id: string) =>
        request<FolderDto>(`/api/folders/${id}/duplicate`, { method: 'POST', body: {} }),
    },
    requests: {
      get: (id: string) => request<ApiRequestDto>(`/api/requests/${id}`),
      /** Collection'daki tüm istekler, tanımlarıyla (çevrimdışı önbellek için). */
      list: (collectionId: string) => request<ApiRequestDto[]>(`/api/collections/${collectionId}/requests`),
      create: (collectionId: string, name: string, folderId: string | null, definition: RequestDefinition) =>
        request<ApiRequestDto>(`/api/collections/${collectionId}/requests`, {
          method: 'POST',
          body: { name, folderId, definition },
        }),
      update: (id: string, name: string, definition: RequestDefinition, version: number) =>
        request<ApiRequestDto>(`/api/requests/${id}`, { method: 'PUT', body: { name, definition, version } }),
      /** sortOrder: hedefteki kardeş istekler arasındaki yeni sıra. */
      move: (id: string, folderId: string | null, sortOrder: number, collectionId?: string) =>
        request<ApiRequestDto>(`/api/requests/${id}/move`, {
          method: 'POST',
          body: { folderId, sortOrder, collectionId: collectionId ?? null },
        }),
      duplicate: (id: string) =>
        request<ApiRequestDto>(`/api/requests/${id}/duplicate`, { method: 'POST', body: {} }),
      remove: (id: string) => request<void>(`/api/requests/${id}`, { method: 'DELETE' }),
      /** Kaydedilmiş sürümler (en yeni önce, anlık görüntüleriyle). */
      versions: (id: string) => request<VersionDto<RequestSnapshot>[]>(`/api/requests/${id}/versions`),
      /** `version` şu anki sürümdür; arada başkası kaydettiyse 409. */
      restore: (id: string, changeId: string, version: number) =>
        request<ApiRequestDto>(`/api/requests/${id}/restore`, {
          method: 'POST',
          body: { changeId, version },
        }),
    },
    environments: {
      list: (workspaceId: string) => request<EnvironmentDto[]>(`/api/workspaces/${workspaceId}/environments`),
      create: (workspaceId: string, name: string, variables: Variable[] = []) =>
        request<EnvironmentDto>(`/api/workspaces/${workspaceId}/environments`, {
          method: 'POST',
          body: { name, variables },
        }),
      update: (id: string, name: string, variables: Variable[], version: number) =>
        request<EnvironmentDto>(`/api/environments/${id}`, {
          method: 'PUT',
          body: { name, variables, version },
        }),
      remove: (id: string) => request<void>(`/api/environments/${id}`, { method: 'DELETE' }),
      versions: (id: string) =>
        request<VersionDto<EnvironmentSnapshot>[]>(`/api/environments/${id}/versions`),
      restore: (id: string, changeId: string, version: number) =>
        request<EnvironmentDto>(`/api/environments/${id}/restore`, {
          method: 'POST',
          body: { changeId, version },
        }),
    },
    activity: {
      feed: (workspaceId: string, before?: string | null) =>
        request<ActivityPage>(
          `/api/workspaces/${workspaceId}/activity${before ? `?before=${encodeURIComponent(before)}` : ''}`,
        ),
      /** Silinmiş isteği son hâliyle (aynı kimlikle) geri getirir. */
      restoreDeleted: (changeId: string) =>
        request<ApiRequestDto>(`/api/activity/${changeId}/restore`, { method: 'POST' }),
    },
    comments: {
      list: (targetType: CommentTarget, targetId: string) =>
        request<CommentDto[]>(`/api/comments?targetType=${targetType}&targetId=${targetId}`),
      create: (targetType: CommentTarget, targetId: string, body: string, parentId?: string | null) =>
        request<CommentDto>('/api/comments', {
          method: 'POST',
          body: { targetType, targetId, body, parentId },
        }),
      edit: (id: string, body: string) =>
        request<CommentDto>(`/api/comments/${id}`, { method: 'PATCH', body: { body } }),
      remove: (id: string) => request<void>(`/api/comments/${id}`, { method: 'DELETE' }),
      resolve: (id: string, resolved: boolean) =>
        request<void>(`/api/comments/${id}/resolve`, { method: 'POST', body: { resolved } }),
      counts: (workspaceId: string) =>
        request<CommentCountDto[]>(`/api/workspaces/${workspaceId}/comment-counts`),
      /** Bahsedilebilecek kişiler (workspace'e erişimi olanlar). */
      people: (workspaceId: string) => request<PersonDto[]>(`/api/workspaces/${workspaceId}/people`),
    },
    apiKeys: {
      list: () => request<ApiKeyDto[]>('/api/me/api-keys'),
      /** `expiresInDays` boşsa süresiz. */
      create: (name: string, expiresInDays: number | null) =>
        request<CreatedApiKeyDto>('/api/me/api-keys', { method: 'POST', body: { name, expiresInDays } }),
      revoke: (id: string) => request<void>(`/api/me/api-keys/${id}`, { method: 'DELETE' }),
    },
    mocks: {
      list: (workspaceId: string) => request<MockServerDto[]>(`/api/workspaces/${workspaceId}/mocks`),
      create: (workspaceId: string, collectionId: string, settings: MockSettings) =>
        request<MockServerDto>(`/api/workspaces/${workspaceId}/mocks`, {
          method: 'POST',
          body: { collectionId, ...settings },
        }),
      update: (id: string, settings: MockSettings & { enabled: boolean }) =>
        request<MockServerDto>(`/api/mocks/${id}`, { method: 'PUT', body: settings }),
      /** Adres sızdıysa: yeni anahtar üretilir, eski adres hemen çalışmaz olur. */
      regenerateKey: (id: string) =>
        request<MockServerDto>(`/api/mocks/${id}/regenerate-key`, { method: 'POST' }),
      remove: (id: string) => request<void>(`/api/mocks/${id}`, { method: 'DELETE' }),
      /** En yeniden eskiye. */
      calls: (id: string, before?: string | null) =>
        request<MockCallDto[]>(
          `/api/mocks/${id}/calls${before ? `?before=${encodeURIComponent(before)}` : ''}`,
        ),
      clearCalls: (id: string) => request<void>(`/api/mocks/${id}/calls`, { method: 'DELETE' }),
      routes: (id: string) => request<MockRouteDto[]>(`/api/mocks/${id}/routes`),
    },
    monitors: {
      list: (workspaceId: string) => request<MonitorDto[]>(`/api/workspaces/${workspaceId}/monitors`),
      create: (workspaceId: string, collectionId: string, settings: MonitorSettings) =>
        request<MonitorDto>(`/api/workspaces/${workspaceId}/monitors`, {
          method: 'POST',
          body: { collectionId, settings },
        }),
      update: (id: string, settings: MonitorSettings) =>
        request<MonitorDto>(`/api/monitors/${id}`, { method: 'PUT', body: settings }),
      remove: (id: string) => request<void>(`/api/monitors/${id}`, { method: 'DELETE' }),
      /** Son `days` günün çalıştırmaları, eskiden yeniye. */
      runs: (id: string, days = 7) => request<MonitorRunPointDto[]>(`/api/monitors/${id}/runs?days=${days}`),
      /** Hemen çalıştırır (zamanlama değişmez); bitince sonucu döner. */
      run: (id: string) => request<MonitorRunPointDto>(`/api/monitors/${id}/run`, { method: 'POST' }),
    },
    gitSync: createGitSyncApi(request),
    forks: {
      create: (collectionId: string, targetWorkspaceId: string, name?: string) =>
        request<ForkInfoDto>(`/api/collections/${collectionId}/forks`, {
          method: 'POST',
          body: { targetWorkspaceId, name: name || null },
        }),
      /** Collection'ın kaynağı (fork'sa) ve görülebilen fork'ları. */
      ofCollection: (collectionId: string) =>
        request<ForkInfoDto[]>(`/api/collections/${collectionId}/forks`),
      /** Workspace'teki fork collection'ları. */
      inWorkspace: (workspaceId: string) => request<ForkInfoDto[]>(`/api/workspaces/${workspaceId}/forks`),
      compare: (forkId: string) => request<ForkComparisonDto>(`/api/forks/${forkId}/compare`),
      /** Çakışmalarda anahtar → "source" (kaynağınkini al) ya da "fork" (benimkini koru). */
      pull: (forkId: string, resolutions: Record<string, 'source' | 'fork'> = {}) =>
        request<ForkComparisonDto>(`/api/forks/${forkId}/pull`, { method: 'POST', body: { resolutions } }),
      unlink: (forkId: string) => request<void>(`/api/forks/${forkId}`, { method: 'DELETE' }),
    },
    mergeRequests: {
      create: (forkId: string, title: string, description: string | null) =>
        request<MergeRequestDto>(`/api/forks/${forkId}/merge-requests`, {
          method: 'POST',
          body: { title, description },
        }),
      list: (workspaceId: string, status?: MergeRequestStatus) =>
        request<MergeRequestDto[]>(
          `/api/workspaces/${workspaceId}/merge-requests${status ? `?status=${status}` : ''}`,
        ),
      get: (id: string) => request<MergeRequestDetailDto>(`/api/merge-requests/${id}`),
      edit: (id: string, title: string, description: string | null) =>
        request<MergeRequestDto>(`/api/merge-requests/${id}`, {
          method: 'PUT',
          body: { title, description },
        }),
      /** Onay verir; ikinci kez çağrılırsa onayı geri alır. */
      approve: (id: string) =>
        request<MergeRequestDto>(`/api/merge-requests/${id}/approve`, { method: 'POST' }),
      merge: (id: string) => request<MergeRequestDto>(`/api/merge-requests/${id}/merge`, { method: 'POST' }),
      decline: (id: string) =>
        request<MergeRequestDto>(`/api/merge-requests/${id}/decline`, { method: 'POST' }),
      close: (id: string) => request<MergeRequestDto>(`/api/merge-requests/${id}/close`, { method: 'POST' }),
    },
    notifications: {
      list: () => request<NotificationsDto>('/api/me/notifications'),
      /** `ids` verilmezse hepsi okundu sayılır. */
      markRead: (ids?: string[]) =>
        request<void>('/api/me/notifications/read', { method: 'POST', body: { ids: ids ?? null } }),
    },
    globals: {
      get: (workspaceId: string) => request<GlobalsDto>(`/api/workspaces/${workspaceId}/globals`),
      update: (workspaceId: string, variables: Variable[]) =>
        request<GlobalsDto>(`/api/workspaces/${workspaceId}/globals`, { method: 'PUT', body: { variables } }),
    },
    runs: {
      /** Masaüstünde yerel ajanda, web'de sunucuda çalışır. */
      start: (body: StartRunRequest, onEvent: (event: RunEvent) => void, signal?: AbortSignal) =>
        options.localAgent
          ? runLocally(body, onEvent, signal)
          : stream<RunEvent>('/api/runs', body, onEvent, signal),
      list: (workspaceId: string, collectionId?: string, limit = 50) => {
        const query = new URLSearchParams({ limit: String(limit) });
        if (collectionId) query.set('collectionId', collectionId);
        return request<RunSummaryDto[]>(`/api/workspaces/${workspaceId}/runs?${query}`);
      },
      get: (id: string) => request<RunDetailDto>(`/api/runs/${id}`),
      remove: (id: string) => request<void>(`/api/runs/${id}`, { method: 'DELETE' }),
    },
    docs: {
      get: (collectionId: string, environmentId?: string | null) =>
        request<DocumentationDto>(
          `/api/collections/${collectionId}/documentation${environmentId ? `?environmentId=${environmentId}` : ''}`,
        ),
      /** Yayınlanmamışsa null. */
      publication: async (collectionId: string) =>
        (await request<DocPublicationDto | undefined>(`/api/collections/${collectionId}/publication`)) ??
        null,
      publish: (collectionId: string, body: { visibility: DocVisibility; environmentId: string | null }) =>
        request<DocPublicationDto>(`/api/collections/${collectionId}/publication`, { method: 'PUT', body }),
      regenerate: (collectionId: string) =>
        request<DocPublicationDto>(`/api/collections/${collectionId}/publication/regenerate`, {
          method: 'POST',
        }),
      unpublish: (collectionId: string) =>
        request<void>(`/api/collections/${collectionId}/publication`, { method: 'DELETE' }),
      /** Yayınlanmış doküman (herkese açık olanlar oturumsuz okunur). */
      published: (slug: string) => request<DocumentationDto>(`/api/docs/${encodeURIComponent(slug)}`),
    },
    examples: {
      list: (requestId: string) => request<ExampleDto[]>(`/api/requests/${requestId}/examples`),
      get: (id: string) => request<ExampleDto>(`/api/examples/${id}`),
      create: (requestId: string, body: CreateExampleRequest) =>
        request<ExampleDto>(`/api/requests/${requestId}/examples`, { method: 'POST', body }),
      update: (
        id: string,
        changes: { name?: string; status?: number; headers?: ExampleDto['headers']; body?: string },
      ) => request<ExampleDto>(`/api/examples/${id}`, { method: 'PATCH', body: changes }),
      remove: (id: string) => request<void>(`/api/examples/${id}`, { method: 'DELETE' }),
    },
    history: {
      list: (workspaceId: string, before?: string, limit = 100) => {
        const query = new URLSearchParams({ limit: String(limit) });
        if (before) query.set('before', before);
        return request<HistoryEntryDto[]>(`/api/workspaces/${workspaceId}/history?${query}`);
      },
      record: (workspaceId: string, body: RecordHistoryRequest) =>
        request<HistoryEntryDto>(`/api/workspaces/${workspaceId}/history`, { method: 'POST', body }),
      response: (id: string) => request<HistoryResponseDto>(`/api/history/${id}/response`),
      remove: (id: string) => request<void>(`/api/history/${id}`, { method: 'DELETE' }),
      clear: (workspaceId: string) =>
        request<void>(`/api/workspaces/${workspaceId}/history`, { method: 'DELETE' }),
    },
    importExport: {
      importPostman: (workspaceId: string, document: unknown) =>
        request<ImportResult>(`/api/workspaces/${workspaceId}/import/postman`, {
          method: 'POST',
          body: document,
        }),
      /**
       * OpenAPI/Swagger belgesini adresten içe aktarır (belge, Swagger UI sayfası ya da sunucu adresi). Masaüstünde
       * belgeyi yerel ajan bu bilgisayardan çeker (localhost ve iç ağ dahil); web'de sunucu çeker. Birden çok sürüm
       * varsa choices döner; seçilen adresle tekrar çağrılır. Header'lar saklanmaz.
       */
      importFromUrl: async (
        workspaceId: string,
        url: string,
        headers: KeyValueItem[] = [],
      ): Promise<UrlImportResponse> => {
        if (options.localAgent) {
          const fetched = await agent<SpecFetchResult>('/openapi/fetch', {
            method: 'POST',
            body: { url, headers },
          });
          if (fetched.choices?.length) return { result: null, choices: fetched.choices };
          return request<UrlImportResponse>(`/api/workspaces/${workspaceId}/import/url`, {
            method: 'POST',
            body: { url: fetched.url, document: fetched.content },
          });
        }
        return request<UrlImportResponse>(`/api/workspaces/${workspaceId}/import/url`, {
          method: 'POST',
          body: { url, headers },
        });
      },
      exportCollection: (id: string) =>
        download(`/api/collections/${id}/export/postman`, 'collection.postman_collection.json'),
      /** OpenAPI 3.0.3 (JSON); YAML'a istemcide çevrilir. */
      exportOpenApi: (id: string) =>
        download(`/api/collections/${id}/export/openapi`, 'collection.openapi.json'),
      exportEnvironment: (id: string) =>
        download(`/api/environments/${id}/export/postman`, 'environment.postman_environment.json'),
    },
    /** Adresten içe aktarılan collection'ın kaynağı ve kaynaktan güncelleme. */
    sources: {
      get: (collectionId: string) => request<CollectionSourceDto>(`/api/collections/${collectionId}/source`),
      schedule: (collectionId: string, checkIntervalHours: number | null) =>
        request<CollectionSourceDto>(`/api/collections/${collectionId}/source/schedule`, {
          method: 'PUT',
          body: { checkIntervalHours },
        }),
      disconnect: (collectionId: string) =>
        request<void>(`/api/collections/${collectionId}/source`, { method: 'DELETE' }),
      /** Belgeyi yeniden çeker (masaüstünde ajan) ve son uygulanan belgeyle farkını döner. */
      preview: async (collectionId: string, url: string, headers: KeyValueItem[] = []) => {
        if (options.localAgent) {
          const fetched = await agent<SpecFetchResult>('/openapi/fetch', {
            method: 'POST',
            body: { url, headers },
          });
          if (!fetched.content) {
            throw new ApiError(
              400,
              msg(
                'core.client.sourceNotDocument',
                'Kaynak adresi artık bir belge değil, sürüm listesi döndürüyor. Bağlantıyı kaldırıp belgeyi yeniden içe aktarın.',
              ),
            );
          }
          return request<SourceDiffDto>(`/api/collections/${collectionId}/source/preview`, {
            method: 'POST',
            body: { document: fetched.content, url: fetched.url },
          });
        }
        return request<SourceDiffDto>(`/api/collections/${collectionId}/source/preview`, {
          method: 'POST',
          body: { headers },
        });
      },
      apply: (collectionId: string, hash: string, keys: string[]) =>
        request<SourceApplyResult>(`/api/collections/${collectionId}/source/apply`, {
          method: 'POST',
          body: { hash, keys },
        }),
    },
    execute: (body: ExecuteRequest) =>
      options.localAgent
        ? agent<ExecuteResponse>('/execute', { method: 'POST', body })
        : request<ExecuteResponse>('/api/execute', { method: 'POST', body }),
    /**
     * İsteği akışlı yürütür (Server-Sent Events): open, her olay için event, sonda done ya da error. Yanıt
     * olay akışı değilse gövde tek bir body olayıyla gelir. signal ile bağlantı kesilir.
     */
    executeStream: async (
      body: ExecuteRequest,
      onEvent: (event: StreamEvent) => void,
      signal?: AbortSignal,
    ) => {
      if (options.localAgent) {
        await readLines(await agentFetch('/execute/stream', { method: 'POST', body, signal }), onEvent);
      } else {
        await stream('/api/execute/stream', body, onEvent, signal);
      }
    },
    /**
     * WebSocket köprüsünün adresi: masaüstünde yerel ajan, web'de sunucu. Tarayıcı WebSocket'te header
     * gönderemediği için oturum token'ı adreste taşınır.
     */
    webSocketRelayUrl: async (): Promise<string> => {
      if (options.localAgent) {
        const local = await options.localAgent();
        return `${local.url.replace(/^http/, 'ws')}/ws-proxy?token=${encodeURIComponent(local.token)}&lang=${coreLanguage()}`;
      }
      // Token'ın süresi dolmuşsa önce yenilenir; WebSocket el sıkışmasında 401 ayrıntısı görülemez.
      let token = options.getAccessToken();
      if (!token || tokenExpired(token)) token = (await refreshSession())?.accessToken ?? token;
      const root = baseUrl() || (typeof location === 'undefined' ? '' : location.origin);
      return `${root.replace(/^http/, 'ws')}/hubs/ws-proxy?access_token=${encodeURIComponent(token ?? '')}&lang=${coreLanguage()}`;
    },
    grpc: {
      /** Servis/metot listesi: .proto dosyalarından ya da server reflection'dan. */
      describe: (body: GrpcDescribeRequest) =>
        options.localAgent
          ? agent<GrpcSchemaDto>('/grpc/describe', { method: 'POST', body })
          : request<GrpcSchemaDto>('/api/grpc/describe', { method: 'POST', body }),
      /** gRPC köprüsünün adresi (WebSocket): masaüstünde yerel ajan, web'de sunucu. */
      relayUrl: async (): Promise<string> => {
        if (options.localAgent) {
          const local = await options.localAgent();
          return `${local.url.replace(/^http/, 'ws')}/grpc-proxy?token=${encodeURIComponent(local.token)}&lang=${coreLanguage()}`;
        }
        let token = options.getAccessToken();
        if (!token || tokenExpired(token)) token = (await refreshSession())?.accessToken ?? token;
        const root = baseUrl() || (typeof location === 'undefined' ? '' : location.origin);
        return `${root.replace(/^http/, 'ws')}/hubs/grpc-proxy?access_token=${encodeURIComponent(token ?? '')}&lang=${coreLanguage()}`;
      },
    },
    oauth2: {
      token: (body: OAuth2TokenRequest) =>
        options.localAgent
          ? agent<OAuth2TokenDto>('/oauth2/token', { method: 'POST', body })
          : request<OAuth2TokenDto>('/api/oauth2/token', { method: 'POST', body }),
    },
  };
}

export type OAuthLoopbackResult =
  | { status: 'pending' }
  | { status: 'done'; code: string | null; error: string | null; errorDescription: string | null };

/** RFC 6266: önce filename* (UTF-8), sonra filename. */
export function fileNameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* düz ada düş */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(disposition);
  return plain?.[1]?.trim() ?? null;
}
