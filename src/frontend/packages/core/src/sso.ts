import type { OrganizationRole } from './types';

/** Organizasyonun doğrulanacak/doğrulanmış e-posta alan adı (sunucudaki SsoDomainDto). */
export interface SsoDomainDto {
  id: string;
  domain: string;
  verified: boolean;
  verifiedAt: string | null;
  /** Oluşturulacak TXT kaydının adı, ör. _apivator.firma.com. */
  recordName: string;
  recordValue: string;
}

export interface SsoSettingsDto {
  configured: boolean;
  enabled: boolean;
  enforced: boolean;
  authority: string | null;
  clientId: string | null;
  hasClientSecret: boolean;
  autoProvision: boolean;
  defaultRole: OrganizationRole;
  /** Kimlik sağlayıcıda kayıtlı olması gereken dönüş adresi. */
  redirectUri: string;
  domains: SsoDomainDto[];
}

export interface UpdateSsoRequest {
  authority: string;
  clientId: string;
  /** null: mevcut secret korunur; "": secret silinir (public client / PKCE). */
  clientSecret: string | null;
  autoProvision: boolean;
  defaultRole: OrganizationRole;
}

export interface SsoStateRequest {
  enabled: boolean;
  enforced: boolean;
}

export interface SsoDiscoveryDto {
  available: boolean;
  /** Bu adresle şifreyle giriş kapalı. */
  enforced: boolean;
  organizationName: string | null;
}

export interface SsoStartRequest {
  email: string;
  /** BASE64URL(SHA-256(codeVerifier)); doğrulayıcı tarayıcıda kalır, değişimde sunucuya verilir. */
  codeChallenge: string;
  /** Yalnızca masaüstü: yerel ajanın dönüş adresi. */
  returnUrl?: string;
  /** Masaüstü: ajanın beklediği state. */
  state?: string;
}

/** Dönüşteki ?error=sso_link_sent hata değildir: hesap bağlama e-postası gönderilmiştir. */
export const SSO_LINK_SENT = 'sso_link_sent';
