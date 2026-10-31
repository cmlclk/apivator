import { useId, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Info } from 'lucide-react';
import { type AuthType, type OAuth2GrantType, type RequestAuth, type VariableMap } from '@apivator/core';
import { OAuth2TokenPanel } from '../oauth/OAuth2TokenPanel';
import { defaultRedirectUri } from '../oauth/oauthFlow';
import { isDesktop } from '../../lib/desktop';
import { useT } from '../../i18n';

const field =
  'h-9 w-full rounded-md border border-line bg-surface px-3 font-mono text-[13px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3">
      <label htmlFor={htmlFor} className="text-[13px] text-fg-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Token ve şifreler varsayılan olarak gizli; göz simgesiyle gösterilir. */
function SecretInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const t = useT('requests');
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={`${field} pe-9`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t('auth.hide') : t('auth.show')}
        className="absolute inset-y-0 end-0 flex w-9 items-center justify-center text-fg-subtle hover:text-fg"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function TextInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      className={field}
    />
  );
}

const GRANT_LABELS: Record<OAuth2GrantType, string> = {
  AuthorizationCode: 'Authorization Code (PKCE)',
  ClientCredentials: 'Client Credentials',
  Password: 'Password Credentials',
};

const EMPTY_VARIABLES: VariableMap = new Map();

export function AuthEditor({
  auth,
  onChange,
  allowInherit,
  inheritedNote,
  inheritedAuth,
  variables = EMPTY_VARIABLES,
}: {
  auth: RequestAuth;
  onChange: (auth: RequestAuth) => void;
  /** Collection'ın üstü olmadığı için orada "miras al" seçeneği yok. */
  allowInherit: boolean;
  /** Miras alındığında hangi yetkilendirmenin kullanılacağını anlatan not. */
  inheritedNote?: ReactNode;
  /** Miras alınan yetkilendirme (OAuth 2.0 ise token paneli burada da gösterilir). */
  inheritedAuth?: RequestAuth;
  /** Token isteğindeki {{değişken}}'leri çözmek için. */
  variables?: VariableMap;
}) {
  const t = useT('requests');
  const id = useId();
  const own: AuthType[] = ['None', 'ApiKey', 'Bearer', 'Basic', 'Digest', 'OAuth2', 'AwsSigV4'];
  const types: AuthType[] = allowInherit ? ['Inherit', ...own] : own;
  const set = (patch: Partial<RequestAuth>) => onChange({ ...auth, ...patch });

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Field label={t('auth.type')} htmlFor={`${id}-type`}>
        <select
          id={`${id}-type`}
          value={auth.type}
          onChange={(e) => set({ type: e.target.value as AuthType })}
          className="h-9 w-56 rounded-md border border-line bg-surface px-2 text-sm"
        >
          {types.map((type) => (
            <option key={type} value={type}>
              {t(`auth.typeLabel.${type}`)}
            </option>
          ))}
        </select>
      </Field>

      {auth.type === 'Inherit' && (
        <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2.5 text-[13px] text-fg-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
          <span>{inheritedNote}</span>
        </p>
      )}
      {auth.type === 'Inherit' && inheritedAuth?.type === 'OAuth2' && (
        <OAuth2TokenPanel auth={inheritedAuth} variables={variables} />
      )}

      {auth.type === 'None' && <p className="text-[13px] text-fg-subtle">{t('auth.noneNote')}</p>}

      {auth.type === 'Bearer' && (
        <Field label="Token" htmlFor={`${id}-token`}>
          <SecretInput
            id={`${id}-token`}
            value={auth.bearerToken}
            onChange={(bearerToken) => set({ bearerToken })}
            placeholder="eyJhbGciOi…"
          />
        </Field>
      )}

      {(auth.type === 'Basic' || auth.type === 'Digest') && (
        <>
          <Field label={t('auth.username')} htmlFor={`${id}-user`}>
            <input
              id={`${id}-user`}
              value={auth.basicUsername}
              onChange={(e) => set({ basicUsername: e.target.value })}
              autoComplete="off"
              className={field}
            />
          </Field>
          <Field label={t('auth.password')} htmlFor={`${id}-pass`}>
            <SecretInput
              id={`${id}-pass`}
              value={auth.basicPassword}
              onChange={(basicPassword) => set({ basicPassword })}
            />
          </Field>
        </>
      )}

      {auth.type === 'ApiKey' && (
        <>
          <Field label={t('auth.keyName')} htmlFor={`${id}-key`}>
            <input
              id={`${id}-key`}
              value={auth.apiKeyName}
              onChange={(e) => set({ apiKeyName: e.target.value })}
              placeholder="X-Api-Key"
              className={field}
            />
          </Field>
          <Field label={t('auth.value')} htmlFor={`${id}-value`}>
            <SecretInput
              id={`${id}-value`}
              value={auth.apiKeyValue}
              onChange={(apiKeyValue) => set({ apiKeyValue })}
            />
          </Field>
          <Field label={t('auth.addTo')} htmlFor={`${id}-in`}>
            <select
              id={`${id}-in`}
              value={auth.apiKeyIn}
              onChange={(e) => set({ apiKeyIn: e.target.value as RequestAuth['apiKeyIn'] })}
              className="h-9 w-56 rounded-md border border-line bg-surface px-2 text-sm"
            >
              <option value="Header">Header</option>
              <option value="Query">{t('auth.queryParam')}</option>
            </select>
          </Field>
        </>
      )}

      {auth.type === 'Digest' && <p className="text-xs text-fg-subtle">{t('auth.digestNote')}</p>}

      {auth.type === 'OAuth2' && (
        <>
          <Field label={t('auth.flow')} htmlFor={`${id}-grant`}>
            <select
              id={`${id}-grant`}
              value={auth.oAuth2GrantType}
              onChange={(e) => set({ oAuth2GrantType: e.target.value as OAuth2GrantType })}
              className="h-9 w-64 rounded-md border border-line bg-surface px-2 text-sm"
            >
              {(Object.keys(GRANT_LABELS) as OAuth2GrantType[]).map((g) => (
                <option key={g} value={g}>
                  {GRANT_LABELS[g]}
                </option>
              ))}
            </select>
          </Field>
          {auth.oAuth2GrantType === 'AuthorizationCode' && (
            <Field label={t('auth.authUrl')} htmlFor={`${id}-authurl`}>
              <TextInput
                id={`${id}-authurl`}
                value={auth.oAuth2AuthUrl}
                onChange={(oAuth2AuthUrl) => set({ oAuth2AuthUrl })}
                placeholder="https://id.example.com/authorize"
              />
            </Field>
          )}
          <Field label="Token URL" htmlFor={`${id}-tokenurl`}>
            <TextInput
              id={`${id}-tokenurl`}
              value={auth.oAuth2TokenUrl}
              onChange={(oAuth2TokenUrl) => set({ oAuth2TokenUrl })}
              placeholder="https://id.example.com/oauth/token"
            />
          </Field>
          <Field label={t('auth.clientId')} htmlFor={`${id}-client`}>
            <TextInput
              id={`${id}-client`}
              value={auth.oAuth2ClientId}
              onChange={(oAuth2ClientId) => set({ oAuth2ClientId })}
            />
          </Field>
          <Field label={t('auth.clientSecret')} htmlFor={`${id}-secret`}>
            <SecretInput
              id={`${id}-secret`}
              value={auth.oAuth2ClientSecret}
              onChange={(oAuth2ClientSecret) => set({ oAuth2ClientSecret })}
              placeholder={auth.oAuth2GrantType === 'AuthorizationCode' ? t('auth.publicClientHint') : ''}
            />
          </Field>
          {auth.oAuth2GrantType === 'Password' && (
            <>
              <Field label={t('auth.username')} htmlFor={`${id}-ouser`}>
                <TextInput
                  id={`${id}-ouser`}
                  value={auth.oAuth2Username}
                  onChange={(oAuth2Username) => set({ oAuth2Username })}
                />
              </Field>
              <Field label={t('auth.password')} htmlFor={`${id}-opass`}>
                <SecretInput
                  id={`${id}-opass`}
                  value={auth.oAuth2Password}
                  onChange={(oAuth2Password) => set({ oAuth2Password })}
                />
              </Field>
            </>
          )}
          <Field label={t('auth.scope')} htmlFor={`${id}-scope`}>
            <TextInput
              id={`${id}-scope`}
              value={auth.oAuth2Scope}
              onChange={(oAuth2Scope) => set({ oAuth2Scope })}
              // eslint-disable-next-line apivator/no-literal-jsx-text -- OAuth scope değerleri protokol belirteçleridir
              placeholder="openid profile"
            />
          </Field>
          {auth.oAuth2GrantType === 'AuthorizationCode' && isDesktop() && (
            <p className="rounded-md bg-muted px-3 py-2.5 text-[13px] text-fg-muted">
              {t.rich(
                'auth.desktopNote',
                { code: (c) => <code className="font-mono">{c}</code> },
                { callback: 'http://127.0.0.1:<port>/oauth/callback', loopback: 'http://127.0.0.1' },
              )}
            </p>
          )}
          {auth.oAuth2GrantType === 'AuthorizationCode' && !isDesktop() && (
            <Field label={t('auth.redirectUri')} htmlFor={`${id}-redirect`}>
              <TextInput
                id={`${id}-redirect`}
                value={auth.oAuth2RedirectUri}
                onChange={(oAuth2RedirectUri) => set({ oAuth2RedirectUri })}
                placeholder={defaultRedirectUri()}
              />
            </Field>
          )}
          <details className="rounded-md border border-line px-3 py-2">
            <summary className="cursor-pointer text-[13px] text-fg-muted">{t('auth.advanced')}</summary>
            <div className="mt-3 flex flex-col gap-4">
              <Field label={t('auth.audience')} htmlFor={`${id}-aud`}>
                <TextInput
                  id={`${id}-aud`}
                  value={auth.oAuth2Audience}
                  onChange={(oAuth2Audience) => set({ oAuth2Audience })}
                />
              </Field>
              <Field label={t('auth.clientAuth')} htmlFor={`${id}-cauth`}>
                <select
                  id={`${id}-cauth`}
                  value={auth.oAuth2ClientAuthentication}
                  onChange={(e) =>
                    set({
                      oAuth2ClientAuthentication: e.target.value as RequestAuth['oAuth2ClientAuthentication'],
                    })
                  }
                  className="h-9 w-64 rounded-md border border-line bg-surface px-2 text-sm"
                >
                  <option value="Header">{t('auth.clientAuthHeader')}</option>
                  <option value="Body">{t('auth.clientAuthBody')}</option>
                </select>
              </Field>
              <Field label={t('auth.headerPrefix')} htmlFor={`${id}-prefix`}>
                <TextInput
                  id={`${id}-prefix`}
                  value={auth.oAuth2HeaderPrefix}
                  onChange={(oAuth2HeaderPrefix) => set({ oAuth2HeaderPrefix })}
                  placeholder="Bearer"
                />
              </Field>
            </div>
          </details>
          <OAuth2TokenPanel auth={auth} variables={variables} />
        </>
      )}

      {auth.type === 'AwsSigV4' && (
        <>
          <Field label={t('auth.accessKey')} htmlFor={`${id}-ak`}>
            <TextInput
              id={`${id}-ak`}
              value={auth.awsAccessKey}
              onChange={(awsAccessKey) => set({ awsAccessKey })}
            />
          </Field>
          <Field label={t('auth.secretKey')} htmlFor={`${id}-sk`}>
            <SecretInput
              id={`${id}-sk`}
              value={auth.awsSecretKey}
              onChange={(awsSecretKey) => set({ awsSecretKey })}
            />
          </Field>
          <Field label={t('auth.region')} htmlFor={`${id}-region`}>
            <TextInput
              id={`${id}-region`}
              value={auth.awsRegion}
              onChange={(awsRegion) => set({ awsRegion })}
              placeholder="eu-central-1"
            />
          </Field>
          <Field label={t('auth.service')} htmlFor={`${id}-service`}>
            <TextInput
              id={`${id}-service`}
              value={auth.awsService}
              onChange={(awsService) => set({ awsService })}
              // eslint-disable-next-line apivator/no-literal-jsx-text -- AWS servis kimlikleri örneği
              placeholder="execute-api, s3, …"
            />
          </Field>
          <Field label={t('auth.sessionToken')} htmlFor={`${id}-session`}>
            <SecretInput
              id={`${id}-session`}
              value={auth.awsSessionToken}
              onChange={(awsSessionToken) => set({ awsSessionToken })}
              placeholder={t('auth.tempCredentials')}
            />
          </Field>
          <p className="text-xs text-fg-subtle">{t('auth.awsNote')}</p>
        </>
      )}

      {(['Bearer', 'Basic', 'ApiKey', 'Digest', 'OAuth2', 'AwsSigV4'] as AuthType[]).includes(auth.type) && (
        <p className="text-xs text-fg-subtle">{t('auth.headersNote')}</p>
      )}
    </div>
  );
}
