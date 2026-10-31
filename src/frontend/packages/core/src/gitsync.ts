/** Git senkronu (sunucudaki GitSync sözleşmeleri). Belirteç hiçbir yanıtta dönmez; yalnızca `hasToken`. */

export type GitChangeType = 'Added' | 'Modified' | 'Removed';

export type GitItemKind = 'Collection' | 'Folder' | 'Request';

/** Çakışmada seçim: uzağınkini al, benimkini koru; "skip" şimdilik dokunma. */
export type GitResolution = 'theirs' | 'mine' | 'skip';

export interface GitSyncDto {
  id: string;
  collectionId: string;
  remoteUrl: string;
  branch: string;
  folderPath: string;
  username: string | null;
  hasToken: boolean;
  lastCommit: string | null;
  lastSyncedAt: string | null;
  lastSyncedByName: string | null;
  remoteHead: string | null;
  /** Son eşitlemeden beri yerelde değişen öğe sayısı. */
  ahead: number;
  /** Son kontrolde uzakta değişen öğe sayısı. */
  behind: number;
  lastCheckedAt: string | null;
  lastError: string | null;
  checkIntervalHours: number | null;
  connectedAt: string;
}

export interface ConnectGitRequest {
  remoteUrl: string;
  branch: string;
  folderPath?: string | null;
  username?: string | null;
  /** Boş/null: mevcut belirteç korunur. */
  token?: string | null;
  clearToken?: boolean;
}

export interface GitPushResult {
  commit: string | null;
  changed: number;
  noChanges: boolean;
  status: GitSyncDto;
}

export interface GitChangeDto {
  key: string;
  kind: GitItemKind;
  name: string;
  path: string;
  local: GitChangeType | null;
  remote: GitChangeType | null;
  conflict: boolean;
  /** Kanonik içerik (JSON); gizli değerler yer tutucudur. */
  mine: string | null;
  theirs: string | null;
  /** Örn. sunucusu değişen istek: yerel gizli değerler yeni sunucuya gider. */
  warning: string | null;
}

export interface GitPullPreviewDto {
  remoteHead: string | null;
  changes: GitChangeDto[];
  conflicts: number;
}

export interface GitPullResult {
  applied: number;
  skipped: number;
  status: GitSyncDto;
}

type Fetcher = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

/** `client.ts` içindeki `request` ile kurulur: `gitSync: createGitSyncApi(request)`. */
export function createGitSyncApi(request: Fetcher) {
  const base = (collectionId: string) => `/api/collections/${collectionId}/git`;
  return {
    /** Bağlı değilse 404 (`git.not_connected`) döner. */
    get: (collectionId: string) => request<GitSyncDto>(base(collectionId)),
    connect: (collectionId: string, body: ConnectGitRequest) =>
      request<GitSyncDto>(base(collectionId), { method: 'PUT', body }),
    disconnect: (collectionId: string) => request<void>(base(collectionId), { method: 'DELETE' }),
    push: (collectionId: string, message?: string, acknowledgeSecrets = false) =>
      request<GitPushResult>(`${base(collectionId)}/push`, {
        method: 'POST',
        body: { message: message || null, acknowledgeSecrets },
      }),
    previewPull: (collectionId: string) =>
      request<GitPullPreviewDto>(`${base(collectionId)}/pull/preview`, { method: 'POST' }),
    pull: (
      collectionId: string,
      expectedHead: string | null,
      resolutions: Record<string, GitResolution> = {},
    ) =>
      request<GitPullResult>(`${base(collectionId)}/pull`, {
        method: 'POST',
        body: { expectedHead, resolutions },
      }),
    setSchedule: (collectionId: string, intervalHours: number | null) =>
      request<GitSyncDto>(`${base(collectionId)}/schedule`, { method: 'PUT', body: { intervalHours } }),
  };
}

export type GitSyncApi = ReturnType<typeof createGitSyncApi>;
