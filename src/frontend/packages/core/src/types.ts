export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  emailConfirmed: boolean;
  /** Profil görseli varsa sürümü (`/api/users/{id}/avatar?v=…`). */
  avatarVersion?: number | null;
  twoFactorEnabled?: boolean;
  /** İki adımlı doğrulamayı zorunlu kılan organizasyonlar; kapalıyken onların workspace'leri görünmez. */
  twoFactorRequiredBy?: string[] | null;
}

/** Şifre doğru, ikinci adım (authenticator kodu ya da yedek kod) bekleniyor. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeToken: string;
  expiresAt: string;
}

export interface TwoFactorStatusDto {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  requiredBy: string[];
}

export interface TwoFactorSetupDto {
  /** Authenticator uygulamasına elle girilecek anahtar (Base32). */
  secret: string;
  /** QR kodun içeriği. */
  otpAuthUri: string;
}

export interface RecoveryCodesDto {
  codes: string[];
}

export type SecurityEventKind =
  | 'LoginSucceeded'
  | 'LoginFailed'
  | 'LockedOut'
  | 'PasswordChanged'
  | 'PasswordReset'
  | 'EmailChanged'
  | 'TwoFactorEnabled'
  | 'TwoFactorDisabled'
  | 'RecoveryCodesRegenerated'
  | 'RecoveryCodeUsed'
  | 'SessionsRevokedByAdmin'
  | 'PasswordResetSentByAdmin';

export interface SecurityEventDto {
  kind: SecurityEventKind;
  createdAt: string;
  device: string | null;
  ipAddress: string | null;
  /** İşlemi organizasyon yöneticisi yaptıysa. */
  actorName: string | null;
  detail: string | null;
}

export interface AuthResult {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: UserDto;
}

export type WorkspaceType = 'Personal' | 'Team' | 'Public';
export type WorkspaceRole = 'Viewer' | 'Editor' | 'Admin';

export interface WorkspaceDto {
  id: string;
  name: string;
  type: WorkspaceType;
  role: WorkspaceRole;
  organizationId: string;
  organizationName: string;
}

export type OrganizationRole = 'Member' | 'Admin' | 'Owner';
export type InvitationStatus = 'Pending' | 'Expired' | 'Accepted' | 'Revoked';

export interface OrganizationDto {
  id: string;
  name: string;
  isPersonal: boolean;
  role: OrganizationRole;
  memberCount: number;
  /** Üyelerin iki adımlı doğrulaması zorunlu. */
  requireTwoFactor?: boolean;
  /** Organizasyon e-postalarının ve yeni üyelerin başlangıç dili ("tr", "en"). */
  defaultLanguage?: string;
}

export interface OrganizationMemberDto {
  userId: string;
  displayName: string;
  email: string;
  role: OrganizationRole;
  joinedAt: string;
  /** Yalnızca yöneticilere gelir. */
  twoFactorEnabled?: boolean | null;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: OrganizationRole;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceRole: WorkspaceRole | null;
  invitedByName: string;
  createdAt: string;
  expiresAt: string;
  status: InvitationStatus;
}

/** Bekleyen davetler yalnızca yöneticilere döner. */
export interface OrganizationMembersDto {
  members: OrganizationMemberDto[];
  invitations: InvitationDto[];
}

export interface InviteRequest {
  email: string;
  role: OrganizationRole;
  workspaceId?: string | null;
  workspaceRole?: WorkspaceRole | null;
  /** Davet e-postasının dili; verilmezse organizasyonun varsayılan dili. */
  language?: string | null;
}

export interface InvitationPreviewDto {
  organizationName: string;
  invitedByName: string;
  email: string;
  workspaceName: string | null;
  status: InvitationStatus;
  accountExists: boolean;
}

export interface MyInvitationDto {
  id: string;
  organizationId: string;
  organizationName: string;
  invitedByName: string;
  workspaceName: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface AcceptedInvitationDto {
  organizationId: string;
  workspaceId: string | null;
}

export interface TeamMemberDto {
  userId: string;
  displayName: string;
  email: string;
}

export interface TeamDto {
  id: string;
  name: string;
  members: TeamMemberDto[];
}

export interface WorkspaceUserDto {
  userId: string;
  displayName: string;
  email: string;
  role: WorkspaceRole;
}

export interface WorkspaceTeamDto {
  teamId: string;
  name: string;
  role: WorkspaceRole;
  memberCount: number;
}

/** Organizasyon yöneticileri takım workspace'lerinde örtük olarak Admin'dir. */
export interface WorkspaceMembersDto {
  users: WorkspaceUserDto[];
  teams: WorkspaceTeamDto[];
  organizationAdmins: WorkspaceUserDto[];
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ResetPasswordRequest {
  email: string;
  token: string;
  newPassword: string;
}

export type FormFieldType = 'Text' | 'File';

export interface KeyValueItem {
  key: string;
  /** form-data dosya alanında dosyanın adı. */
  value: string;
  enabled: boolean;
  description?: string | null;
  /** Yalnızca form-data alanlarında anlamlı; yoksa Text. */
  type?: FormFieldType;
}

export type BodyMode = 'None' | 'Raw' | 'UrlEncoded' | 'FormData' | 'Binary' | 'GraphQL';
export type RawLanguage = 'Json' | 'Text' | 'Xml' | 'Html' | 'JavaScript';

export interface RequestBody {
  mode: BodyMode;
  rawLanguage: RawLanguage;
  /** Raw metni; GraphQL modunda sorgu. */
  raw: string;
  form: KeyValueItem[];
  /** Binary modda dosyanın adı (içerik saklanmaz, gönderimde eklenir). */
  fileName?: string | null;
  /** GraphQL değişkenleri (JSON metni). */
  graphqlVariables: string;
}

export type AuthType = 'Inherit' | 'None' | 'ApiKey' | 'Bearer' | 'Basic' | 'Digest' | 'OAuth2' | 'AwsSigV4';
export type ApiKeyLocation = 'Header' | 'Query';
export type OAuth2GrantType = 'ClientCredentials' | 'Password' | 'AuthorizationCode';
export type OAuth2ClientAuthentication = 'Header' | 'Body';

export interface RequestAuth {
  type: AuthType;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyIn: ApiKeyLocation;
  bearerToken: string;
  /** Basic ve Digest ortak kullanır. */
  basicUsername: string;
  basicPassword: string;
  oAuth2GrantType: OAuth2GrantType;
  oAuth2AuthUrl: string;
  oAuth2TokenUrl: string;
  oAuth2ClientId: string;
  oAuth2ClientSecret: string;
  oAuth2Scope: string;
  oAuth2Audience: string;
  oAuth2Username: string;
  oAuth2Password: string;
  oAuth2RedirectUri: string;
  oAuth2ClientAuthentication: OAuth2ClientAuthentication;
  oAuth2HeaderPrefix: string;
  /** Yalnızca gönderimde doldurulur; sunucu kaydederken siler. */
  oAuth2AccessToken: string;
  awsAccessKey: string;
  awsSecretKey: string;
  awsRegion: string;
  awsService: string;
  awsSessionToken: string;
}

export interface OAuth2TokenRequest {
  auth: RequestAuth;
  code?: string | null;
  codeVerifier?: string | null;
  redirectUri?: string | null;
  refreshToken?: string | null;
}

export interface OAuth2TokenDto {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string | null;
  expiresIn: number | null;
  scope: string | null;
}

export interface ScriptSet {
  /** İstek gönderilmeden önce çalışır. */
  preRequest: string;
  /** Yanıttan sonra çalışır (Postman'deki "Tests"). */
  postResponse: string;
}

/** İsteğin türü: normal HTTP, Server-Sent Events akışı, WebSocket bağlantısı ya da gRPC çağrısı. */
export type RequestKind = 'Http' | 'Sse' | 'WebSocket' | 'Grpc';

/** gRPC isteğine yüklenmiş .proto dosyası. */
export interface ProtoFile {
  name: string;
  content: string;
}

/** gRPC isteğinin ayarları; metadata isteğin header'larıdır. */
export interface GrpcSettings {
  /** "/paket.Servis/Metot" */
  method: string;
  /** true: tanımlar sunucunun reflection servisinden; false: yüklenen .proto dosyalarından. */
  useReflection: boolean;
  protoFiles: ProtoFile[];
  /** JSON mesaj ({{değişken}} içerebilir). */
  message: string;
  deadlineSeconds?: number | null;
}

export interface GrpcDescribeRequest {
  url: string | null;
  metadata: { key: string; value: string }[] | null;
  protoFiles: ProtoFile[] | null;
  useReflection: boolean;
}

export interface GrpcMethodDto {
  name: string;
  path: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
  inputType: string;
  outputType: string;
  /** Varsayılan değerlerle örnek istek mesajı (JSON). */
  sample: string;
  /** Girdi ve çıktı mesajlarının JSON Schema'sı (model üretimi için). */
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
}

export interface GrpcServiceDto {
  name: string;
  methods: GrpcMethodDto[];
}

export interface GrpcSchemaDto {
  services: GrpcServiceDto[];
  /** base64 FileDescriptorSet; çağrı başlatılırken köprüye geri gönderilir. */
  descriptorSet: string;
  warnings: string[];
}

/** WebSocket isteğinde kaydedilmiş, tek tıkla gönderilebilen mesaj. */
export interface SavedMessage {
  name: string;
  body: string;
  /** true ise body base64 kodlu ikili veridir. */
  binary?: boolean;
}

export interface RequestDefinition {
  /** Yoksa Http. */
  kind?: RequestKind;
  /** Markdown açıklama (dokümantasyonda gösterilir). */
  description?: string;
  method: string;
  url: string;
  headers: KeyValueItem[];
  body: RequestBody;
  auth: RequestAuth;
  scripts: ScriptSet;
  /** WebSocket: kayıtlı mesajlar. */
  messages?: SavedMessage[];
  /** WebSocket: virgülle ayrılmış alt protokoller. */
  protocols?: string;
  /** gRPC ayarları. */
  grpc?: GrpcSettings;
}

export interface Variable {
  key: string;
  /** Başlangıç değeri: ekiple paylaşılır, sunucuda saklanır. */
  value: string;
  enabled: boolean;
  isSecret: boolean;
}

export interface EnvironmentDto {
  id: string;
  workspaceId: string;
  name: string;
  variables: Variable[];
  version: number;
  updatedAt: string;
}

export interface GlobalsDto {
  workspaceId: string;
  variables: Variable[];
}

export interface FolderDto {
  id: string;
  parentFolderId: string | null;
  name: string;
  sortOrder: number;
  auth: RequestAuth;
  scripts: ScriptSet;
  /** Markdown açıklama (dokümantasyonda gösterilir). */
  description?: string | null;
}

export interface RequestSummaryDto {
  id: string;
  folderId: string | null;
  name: string;
  method: string;
  sortOrder: number;
  kind?: RequestKind;
  /** Kaydedilen sürüm; çevrimdışı önbellek yalnızca değişenleri indirir. */
  version?: number;
}

export interface CollectionTreeDto {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  auth: RequestAuth;
  variables: Variable[];
  folders: FolderDto[];
  requests: RequestSummaryDto[];
  examples: ExampleSummaryDto[];
  scripts: ScriptSet;
  /** Bu kullanıcının collection'daki etkin rolü (collection rolleri dahil); eski sunucularda yok. */
  role?: WorkspaceRole | null;
  /** true ise collection'ı yalnızca yöneticiler ve Editor rolü verilenler düzenleyebilir. */
  editingRestricted?: boolean;
  /** Adresten (OpenAPI/Swagger) içe aktarıldıysa kaynağı; changeDetected: otomatik kontrol değişiklik buldu. */
  source?: { url: string; changeDetected: boolean } | null;
}

export type CollectionAccessSubject = 'User' | 'Team';

export interface CollectionAccessEntryDto {
  id: string;
  kind: CollectionAccessSubject;
  subjectId: string;
  name: string;
  email: string | null;
  role: WorkspaceRole;
  /** Kişinin ya da takımın workspace'teki rolü; workspace'e eklenmemiş takımda null. */
  workspaceRole: WorkspaceRole | null;
}

export interface CollectionAccessDto {
  collectionId: string;
  editingRestricted: boolean;
  canManage: boolean;
  myRole: WorkspaceRole;
  entries: CollectionAccessEntryDto[];
}

export interface CollectionAccessInput {
  userId?: string | null;
  teamId?: string | null;
  role: WorkspaceRole;
}

export interface ApiRequestDto {
  id: string;
  collectionId: string;
  folderId: string | null;
  name: string;
  definition: RequestDefinition;
  version: number;
  updatedAt: string;
}

export interface ExecuteRequest {
  method: string;
  url: string;
  headers: KeyValueItem[];
  body: RequestBody;
  /** Miras çözülmüş hâli; Inherit gönderilirse yetkilendirme uygulanmaz. */
  auth: RequestAuth;
  timeoutMs?: number;
  /** Dosya içerikleri; index body.form sırasıdır, binary için -1. */
  files?: ExecuteFile[];
  /** Collection → klasörler → istek sırasıyla. */
  preRequestScripts?: string[];
  postResponseScripts?: string[];
  /** Verilirse {{değişken}}'ler sunucuda, pre-request script'lerinden sonra çözülür. */
  variables?: ExecutionVariables;
  info?: {
    requestName?: string | null;
    requestId?: string | null;
    iteration?: number;
    iterationCount?: number;
  };
}

/** Değişken kapsamlarının etkin değerleri (güncel değer ya da başlangıç değeri). */
export interface ExecutionVariables {
  environment?: Record<string, string> | null;
  collection?: Record<string, string> | null;
  globals?: Record<string, string> | null;
  data?: Record<string, string> | null;
  environmentName?: string | null;
}

export type TestStatus = 'passed' | 'failed' | 'skipped';

export interface TestResult {
  name: string;
  status: TestStatus;
  error: string | null;
}

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  phase: 'prerequest' | 'test';
}

export interface SentRequest {
  method: string;
  url: string;
  headers: HttpHeader[];
  body: string | null;
}

export interface ExecuteFile {
  index: number;
  fileName: string;
  contentType: string | null;
  contentBase64: string;
}

export interface HttpHeader {
  key: string;
  value: string;
}

/** Akışlı yürütme (/execute/stream) olayı: open, event (SSE), body (akış olmayan yanıt), done, error. */
export interface StreamEvent {
  type: 'open' | 'event' | 'body' | 'done' | 'error';
  status?: number | null;
  statusText?: string | null;
  headers?: HttpHeader[] | null;
  /** SSE olay adı; belirtilmemişse "message". */
  event?: string | null;
  data?: string | null;
  id?: string | null;
  message?: string | null;
  elapsedMs?: number | null;
}

export interface ExecuteResponse {
  status: number | null;
  statusText: string | null;
  headers: HttpHeader[];
  body: string;
  bodyEncoding: 'text' | 'base64';
  size: number;
  truncated: boolean;
  timeMs: number;
  finalUrl: string | null;
  error: { code: string; message: string } | null;
  /** Script'lerle çalıştırıldıysa: */
  tests?: TestResult[];
  console?: ConsoleEntry[];
  variables?: ExecutionVariables | null;
  nextRequest?: { value: string | null } | null;
  skipped?: boolean;
  request?: SentRequest | null;
}

export interface HistoryEntryDto {
  id: string;
  requestId: string | null;
  method: string;
  url: string;
  definition: RequestDefinition;
  status: number | null;
  timeMs: number | null;
  size: number | null;
  executedAt: string;
  /** Yanıt gövdesi saklandı (kullanıcı tercihi açıkken; 30 gün). */
  hasResponse?: boolean;
}

/** Geçmişte saklanan yanıt gövdesi (yalnızca metin; en çok 256 K karakter). */
export interface HistoryResponseDto {
  body: string;
  contentType: string | null;
  truncated: boolean;
}

export interface RecordHistoryRequest {
  definition: RequestDefinition;
  requestId: string | null;
  status: number | null;
  timeMs: number | null;
  size: number | null;
  /** Yalnızca "yanıtları sakla" tercihi açıkken gönderilir; sunucu tercihi yine denetler. */
  response?: HistoryResponseDto | null;
}

export interface ImportResult {
  kind: 'collection' | 'environment';
  id: string;
  name: string;
  folders: number;
  requests: number;
  variables: number;
  examples: number;
  warnings: string[];
}

/** Swagger UI'daki belge sürümü seçeneği. */
export interface SpecChoice {
  name: string;
  url: string;
}

/** Ajanın (ya da sunucunun) bulduğu belge ya da seçilecek sürümler. */
export interface SpecFetchResult {
  url: string | null;
  /** JSON ya da YAML metni. */
  content: string | null;
  choices: SpecChoice[] | null;
  tried: string[];
}

export interface UrlImportResponse {
  result: ImportResult | null;
  choices: SpecChoice[] | null;
}

export interface CollectionSourceDto {
  url: string;
  /** Belge masaüstünden (bu bilgisayardan) çekildi. */
  local: boolean;
  version: string | null;
  importedAt: string;
  updatedAt: string;
  /** Otomatik kontrol aralığı (saat); null ise kapalı. */
  checkIntervalHours: number | null;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
  changeDetectedAt: string | null;
}

export interface SourceChangeDto {
  /** "GET /pets/{id}" */
  key: string;
  method: string;
  path: string;
  name: string;
  folder: string | null;
  requestId: string | null;
  /** Değişen bölümler: Adres, Query parametreleri, Header'lar, Gövde, Yetkilendirme, Açıklama, Ad, Örnek yanıtlar. */
  fields: string[];
  notes: string[];
}

export interface SourceDiffDto {
  hash: string;
  url: string;
  fromVersion: string | null;
  toVersion: string | null;
  added: SourceChangeDto[];
  changed: SourceChangeDto[];
  removed: SourceChangeDto[];
  newVariables: string[];
  warnings: string[];
}

export interface SourceApplyResult {
  added: number;
  updated: number;
  removed: number;
  variables: number;
  source: CollectionSourceDto;
}

export interface DownloadedFile {
  blob: Blob;
  fileName: string;
}

export interface ExampleSummaryDto {
  id: string;
  requestId: string;
  name: string;
  status: number;
}

export interface ExampleDto extends ExampleSummaryDto {
  headers: KeyValueItem[];
  body: string;
  /** Örneğin alındığı istek tanımı. */
  request: RequestDefinition;
  updatedAt: string;
}

export interface CreateExampleRequest {
  name: string;
  status: number;
  headers: KeyValueItem[];
  body: string;
  request: RequestDefinition | null;
}

export interface StartRunRequest {
  collectionId: string;
  folderId?: string | null;
  /** Boşsa tümü; doluysa yalnızca seçilenler (ağaç sırasıyla). */
  requestIds?: string[] | null;
  iterations?: number;
  delayMs?: number;
  data?: Record<string, string>[] | null;
  variables?: ExecutionVariables | null;
  /** Tarayıcıda alınmış OAuth 2.0 token'ları; anahtar oauth2Fingerprint(). */
  oAuth2Tokens?: Record<string, string> | null;
}

export interface RunTestResult {
  name: string;
  status: TestStatus;
  error: string | null;
}

export interface RunResultEntry {
  iteration: number;
  requestId: string;
  name: string;
  method: string;
  url: string;
  status: number | null;
  timeMs: number;
  size: number;
  error: string | null;
  tests: RunTestResult[];
}

export type RunStatus = 'Completed' | 'Stopped' | 'Failed';
/** Server: sunucuda; Desktop: masaüstü uygulamasında, kullanıcının bilgisayarında yürütüldü. */
export type RunOrigin = 'Server' | 'Desktop' | 'Cli' | 'Monitor';

/** Masaüstünde yerel çalıştırma için collection'ın tamamı (sunucudan alınır, ajana verilir). */
export interface RunSourceDto {
  collectionId: string;
  name: string;
  auth: RequestAuth;
  scripts: ScriptSet;
  variables: Variable[];
  folders: {
    id: string;
    parentFolderId: string | null;
    name: string;
    sortOrder: number;
    auth: RequestAuth;
    scripts: ScriptSet;
  }[];
  requests: {
    id: string;
    folderId: string | null;
    name: string;
    sortOrder: number;
    definition: RequestDefinition;
  }[];
}

/** Ajanın çalıştırma sonunda ürettiği rapor içeriği. */
export interface LocalRunReport {
  name: string;
  iterations: number;
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  results: RunResultEntry[];
}

export interface RunReportRequest extends LocalRunReport {
  collectionId: string;
  folderId: string | null;
  environmentName: string | null;
  delayMs: number;
}

export interface RunSummaryDto {
  id: string;
  collectionId: string;
  folderId: string | null;
  name: string;
  environmentName: string | null;
  userName: string;
  iterations: number;
  status: RunStatus;
  origin: RunOrigin;
  startedAt: string;
  finishedAt: string;
  totalRequests: number;
  failedRequests: number;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
  totalTimeMs: number;
}

export interface RunDetailDto {
  summary: RunSummaryDto;
  delayMs: number;
  results: RunResultEntry[];
}

export interface RunEvent {
  type: 'start' | 'result' | 'warning' | 'done';
  runId?: string;
  iterations?: number;
  requests?: { id: string; name: string; method: string }[];
  result?: RunResultEntry;
  console?: ConsoleEntry[];
  summary?: RunSummaryDto;
  variables?: ExecutionVariables;
  message?: string;
  /** Yalnızca ajandan: kaydedilecek rapor (istemci sunucuya gönderir). */
  report?: LocalRunReport;
}

// --- Faz 3.4: değişiklik geçmişi, yorumlar, bildirimler ---

export type ChangeTarget = 'Collection' | 'Folder' | 'Request' | 'Environment' | 'Example';
export type ChangeAction = 'Created' | 'Updated' | 'Renamed' | 'Moved' | 'Deleted' | 'Restored';

export interface ActivityDto {
  id: string;
  targetType: ChangeTarget;
  targetId: string;
  collectionId: string | null;
  targetName: string;
  action: ChangeAction;
  detail: string | null;
  userId: string | null;
  userName: string;
  version: number | null;
  createdAt: string;
  /** Silinen istek son hâliyle geri getirilebilir. */
  restorable: boolean;
}

export interface ActivityPage {
  items: ActivityDto[];
  nextBefore: string | null;
}

export interface RequestSnapshot {
  name: string;
  definition: RequestDefinition;
  collectionId: string;
  folderId: string | null;
}

export interface EnvironmentSnapshot {
  name: string;
  variables: Variable[];
}

export interface VersionDto<T> {
  id: string;
  action: ChangeAction;
  detail: string | null;
  userId: string | null;
  userName: string;
  version: number | null;
  createdAt: string;
  snapshot: T | null;
}

export type CommentTarget = 'Request' | 'Collection' | 'MergeRequest';

export interface CommentDto {
  id: string;
  parentId: string | null;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  editedAt: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  canEdit: boolean;
  canDelete: boolean;
}

export interface PersonDto {
  userId: string;
  displayName: string;
  email: string;
}

export interface CommentCountDto {
  targetType: CommentTarget;
  targetId: string;
  open: number;
}

export type NotificationKind =
  | 'Mention'
  | 'Reply'
  | 'MergeRequestOpened'
  | 'MergeRequestMerged'
  | 'MergeRequestDeclined'
  | 'SourceChanged';

export interface NotificationDto {
  id: string;
  kind: NotificationKind;
  workspaceId: string;
  /** Merge isteği bildirimlerinde boş. */
  commentId: string | null;
  targetType: CommentTarget;
  targetId: string;
  targetName: string;
  actorName: string;
  preview: string;
  createdAt: string;
  read: boolean;
}

export interface NotificationsDto {
  items: NotificationDto[];
  unread: number;
}

// --- Faz 3.5: kişisel API anahtarları (CLI ve CI) ---

export interface ApiKeyDto {
  id: string;
  name: string;
  /** Tanımak için anahtarın başı ("apv_Xy12Ab"). */
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  active: boolean;
}

export interface CreatedApiKeyDto {
  key: ApiKeyDto;
  /** Anahtarın kendisi: yalnızca oluşturulurken bir kez döner. */
  secret: string;
}

/** Collection'ın örnek yanıtlarını `/mock/{key}/...` adresinde sunan sahte sunucu. */
export interface MockServerDto {
  id: string;
  workspaceId: string;
  collectionId: string;
  collectionName: string;
  environmentId: string | null;
  name: string;
  key: string;
  /** Sunucu adresine eklenecek yol: `/mock/{key}`. */
  path: string;
  /** Gizliyse çağıranın `x-api-key` header'ında workspace üyesinin API anahtarı olmalı. */
  isPrivate: boolean;
  delayMs: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MockSettings {
  name: string;
  environmentId: string | null;
  isPrivate: boolean;
  delayMs: number;
}

export interface MockCallDto {
  id: string;
  at: string;
  method: string;
  /** Mock adresinden sonraki yol ve query. */
  path: string;
  status: number;
  exampleId: string | null;
  /** "İstek adı / Örnek adı"; eşleşme yoksa null. */
  matchedName: string | null;
  error: string | null;
  durationMs: number;
  requestHeaders: KeyValueItem[];
  requestBody: string;
}

/** Mock'un yanıt verdiği bir uç nokta (bir örnek yanıt). */
export interface MockRouteDto {
  exampleId: string;
  requestId: string;
  requestName: string;
  exampleName: string;
  method: string;
  /** Mock adresinden sonraki yol; `:id` ve çözülemeyen `{{değişken}}` her değere uyar. */
  path: string;
  status: number;
}

export type MonitorNotifyMode = 'Changes' | 'EveryFailure';
export type WebhookKind = 'Generic' | 'Slack' | 'Teams';
export type MonitorHealth = 'Healthy' | 'Failing';

/** Collection'ı zamanlanmış olarak sunucuda çalıştıran monitör. */
export interface MonitorDto {
  id: string;
  workspaceId: string;
  collectionId: string;
  collectionName: string;
  environmentId: string | null;
  name: string;
  /** 5 alanlı cron ifadesi, `timeZone`'a göre. */
  schedule: string;
  timeZone: string;
  enabled: boolean;
  notifyEmails: string[];
  webhookUrl: string | null;
  webhookKind: WebhookKind;
  notifyMode: MonitorNotifyMode;
  /** Çalıştırmalar bu kişinin yetkisiyle yapılır. */
  createdById: string;
  createdByName: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  health: MonitorHealth | null;
  consecutiveFailures: number;
  /** Monitör durdurulduysa nedeni. */
  lastError: string | null;
  createdAt: string;
}

export interface MonitorSettings {
  name: string;
  environmentId: string | null;
  schedule: string;
  timeZone: string;
  notifyEmails: string[];
  webhookUrl: string | null;
  webhookKind: WebhookKind;
  notifyMode: MonitorNotifyMode;
  enabled: boolean;
}

/** Monitör geçmişinde bir çalıştırma. */
export interface MonitorRunPointDto {
  id: string;
  startedAt: string;
  finishedAt: string;
  origin: RunOrigin;
  status: RunStatus;
  healthy: boolean;
  totalRequests: number;
  requestErrors: number;
  testsPassed: number;
  testsFailed: number;
  totalTimeMs: number;
}

export type ForkItemKind = 'Collection' | 'Folder' | 'Request';
export type ForkChangeType = 'Added' | 'Modified' | 'Removed';
export type MergeRequestStatus = 'Open' | 'Merged' | 'Declined' | 'Closed';

/** Fork karşılaştırmasında bir öğenin anlık görüntüsü (alanlar öğe türüne göre dolar). */
export interface ForkSnapshot {
  name: string;
  /** Üst klasörün anahtarı ("link:…"); kökte null. */
  parent: string | null;
  definition: RequestDefinition | null;
  examples: { name: string; status: number; headers: KeyValueItem[]; body: string }[] | null;
  description: string | null;
  auth: RequestAuth | null;
  variables: Variable[] | null;
  scripts: ScriptSet | null;
}

/** Fork bağı; kullanıcının göremediği tarafın adları null. */
export interface ForkInfoDto {
  id: string;
  forkCollectionId: string;
  forkName: string | null;
  forkWorkspaceId: string | null;
  forkWorkspaceName: string | null;
  sourceCollectionId: string;
  sourceName: string | null;
  sourceWorkspaceId: string | null;
  sourceWorkspaceName: string | null;
  createdByName: string;
  createdAt: string;
  lastPulledAt: string | null;
}

/** Bir öğenin son eşitlemeye göre iki taraftaki değişikliği. */
export interface ForkChangeDto {
  key: string;
  kind: ForkItemKind;
  name: string;
  path: string;
  forkChange: ForkChangeType | null;
  sourceChange: ForkChangeType | null;
  conflict: boolean;
  base: ForkSnapshot | null;
  fork: ForkSnapshot | null;
  source: ForkSnapshot | null;
}

export interface ForkComparisonDto {
  fork: ForkInfoDto;
  changes: ForkChangeDto[];
  outgoing: number;
  incoming: number;
  conflicts: number;
}

export interface MergeRequestDto {
  id: string;
  forkId: string | null;
  workspaceId: string;
  sourceCollectionId: string;
  sourceName: string;
  forkCollectionId: string;
  forkName: string | null;
  forkWorkspaceName: string | null;
  title: string;
  description: string | null;
  status: MergeRequestStatus;
  authorId: string;
  authorName: string;
  approvals: { userId: string; name: string; at: string }[];
  mergedChanges: { kind: ForkItemKind; name: string; change: ForkChangeType }[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedByName: string | null;
  canMerge: boolean;
  canClose: boolean;
}

export interface MergeRequestDetailDto {
  request: MergeRequestDto;
  /** Açık istekte canlı hesaplanan, fork'ta değişen öğeler. */
  changes: ForkChangeDto[];
  conflicts: number;
}

// ---------------------------------------------------------------- dokümantasyon

export type DocVisibility = 'Organization' | 'Public';

export interface DocVariableDto {
  key: string;
  /** Gizli değişkenlerde boştur. */
  value: string;
  isSecret: boolean;
  source: 'collection' | 'environment';
}

/** Yetkilendirmenin gizli olmayan özeti. */
export interface DocAuthDto {
  type: AuthType;
  detail: string | null;
  /** "collection", klasör adı ya da (isteğin kendisi) null. */
  source: string | null;
}

export interface DocFolderDto {
  id: string;
  parentFolderId: string | null;
  name: string;
  description: string | null;
  sortOrder: number;
}

export interface DocExampleDto {
  id: string;
  name: string;
  status: number;
  headers: KeyValueItem[];
  body: string;
  bodyTruncated: boolean;
  requestUrl: string | null;
  requestBody: string | null;
}

export interface DocRequestDto {
  id: string;
  folderId: string | null;
  name: string;
  sortOrder: number;
  kind: RequestKind;
  method: string;
  url: string;
  description: string;
  headers: KeyValueItem[];
  body: RequestBody;
  auth: DocAuthDto;
  grpcMethod: string | null;
  examples: DocExampleDto[];
}

export interface DocumentationDto {
  collectionId: string;
  name: string;
  description: string | null;
  workspaceName: string;
  auth: DocAuthDto;
  environmentName: string | null;
  variables: DocVariableDto[];
  folders: DocFolderDto[];
  requests: DocRequestDto[];
  updatedAt: string;
}

export interface DocPublicationDto {
  slug: string;
  /** Paylaşılacak tam adres (sunucunun App:PublicUrl ayarıyla). */
  url: string;
  visibility: DocVisibility;
  environmentId: string | null;
  environmentName: string | null;
  publishedBy: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Hesap ve profil (6.3) ----

export interface ProfileWorkspaceDto {
  id: string;
  name: string;
  type: WorkspaceType;
  role: WorkspaceRole;
}

export interface ProfileOrganizationDto {
  id: string;
  name: string;
  isPersonal: boolean;
  role: OrganizationRole;
  memberCount: number;
  workspaces: ProfileWorkspaceDto[];
}

export interface ProfileDto {
  id: string;
  email: string;
  displayName: string;
  emailConfirmed: boolean;
  /** Doğrulama bekleyen yeni e-posta. */
  pendingEmail: string | null;
  createdAt: string;
  avatarVersion: number | null;
  organizations: ProfileOrganizationDto[];
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export type SessionApp = 'web' | 'desktop' | 'cli';

export interface SessionDto {
  id: string;
  /** "Chrome · Windows", "Apivator Masaüstü · macOS" gibi. */
  device: string;
  app: SessionApp;
  ipAddress: string | null;
  startedAt: string;
  lastUsedAt: string;
  current: boolean;
}

export type ThemePreference = 'system' | 'light' | 'dark';

export interface PreferencesDto {
  theme: ThemePreference;
  defaultWorkspaceId: string | null;
  emailMentions: boolean;
  emailMergeRequests: boolean;
  emailMonitorAlerts: boolean;
  /** Arayüz dili ("tr", "en"); null ise tarayıcı dili kullanılır. */
  language?: string | null;
  /** Geçmişte yanıt gövdeleri de saklansın (varsayılan kapalı). */
  saveHistoryResponses?: boolean;
}

export interface OrganizationRefDto {
  id: string;
  name: string;
  memberCount: number;
}

/** mustTransfer boş değilse hesap silinemez; willDelete hesapla birlikte silinir. */
export interface AccountDeletionCheckDto {
  mustTransfer: OrganizationRefDto[];
  willDelete: OrganizationRefDto[];
}
