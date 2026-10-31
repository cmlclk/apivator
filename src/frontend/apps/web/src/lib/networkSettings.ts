import { AGENT_TOKEN_HEADER, ApiError, type LocalAgent } from '@apivator/core';
import { agentInfo, secrets } from './desktop';

export type ProxyMode = 'System' | 'None' | 'Custom';

export interface ClientCertificateSetting {
  /** Sertifikanın sunulacağı sunucu: api.ornek.com ya da *.ornek.com */
  host: string;
  /** .pfx/.p12 ya da PEM sertifika dosyasının yolu. */
  path: string;
  /** PEM için ayrı anahtar dosyası (sertifikayla aynı dosyadaysa boş). */
  keyPath?: string | null;
  password?: string | null;
}

/** Masaüstündeki istekler için proxy ve SSL ayarları (yerel ajana uygulanır). */
export interface NetworkSettings {
  proxyMode: ProxyMode;
  proxyUrl: string;
  proxyUsername: string;
  proxyPassword: string;
  proxyBypass: string[];
  verifySsl: boolean;
  caCertificatePaths: string[];
  clientCertificates: ClientCertificateSetting[];
}

export const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  proxyMode: 'System',
  proxyUrl: '',
  proxyUsername: '',
  proxyPassword: '',
  proxyBypass: ['localhost', '127.0.0.1'],
  verifySsl: true,
  caCertificatePaths: [],
  clientCertificates: [],
};

const STORAGE_KEY = 'apivator-network-settings';
const PROXY_PASSWORD = 'network:proxy_password';
const certPasswordKey = (index: number) => `network:cert_password:${index}`;

/** Parolalar anahtar zincirinde; geri kalanı bu bilgisayarın yerel deposunda. */
export async function loadNetworkSettings(): Promise<NetworkSettings> {
  let stored: Partial<NetworkSettings> = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<NetworkSettings>;
  } catch {
    stored = {};
  }
  const settings: NetworkSettings = { ...DEFAULT_NETWORK_SETTINGS, ...stored };
  const read = async (key: string) => {
    try {
      return (await secrets.get(key)) ?? '';
    } catch {
      return '';
    }
  };
  settings.proxyPassword = await read(PROXY_PASSWORD);
  settings.clientCertificates = await Promise.all(
    (settings.clientCertificates ?? []).map(async (c, i) => ({
      ...c,
      password: await read(certPasswordKey(i)),
    })),
  );
  return settings;
}

async function persist(settings: NetworkSettings, previousCertCount: number) {
  const withoutSecrets: NetworkSettings = {
    ...settings,
    proxyPassword: '',
    clientCertificates: settings.clientCertificates.map((c) => ({ ...c, password: null })),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withoutSecrets));
  } catch {
    // Kaydedilemezse ayarlar bu oturumla sınırlı kalır.
  }
  const write = async (key: string, value: string | null | undefined) => {
    try {
      await (value ? secrets.set(key, value) : secrets.remove(key));
    } catch {
      // Anahtar zinciri yoksa parola yalnızca bu oturumda ajanda kalır.
    }
  };
  await write(PROXY_PASSWORD, settings.proxyPassword);
  const count = Math.max(previousCertCount, settings.clientCertificates.length);
  for (let i = 0; i < count; i++) await write(certPasswordKey(i), settings.clientCertificates[i]?.password);
}

/** Ayarları ajana gönderir; ajan dosyaları okuyup doğrular, hata varsa hiçbirini uygulamaz. */
export async function applyToAgent(agent: LocalAgent, settings: NetworkSettings): Promise<void> {
  const clean = (list: string[]) => list.map((s) => s.trim()).filter(Boolean);
  const response = await fetch(`${agent.url}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', [AGENT_TOKEN_HEADER]: agent.token },
    body: JSON.stringify({
      ...settings,
      proxyUrl: settings.proxyUrl.trim() || null,
      proxyUsername: settings.proxyUsername.trim() || null,
      proxyPassword: settings.proxyPassword || null,
      proxyBypass: clean(settings.proxyBypass),
      caCertificatePaths: clean(settings.caCertificatePaths),
      clientCertificates: settings.clientCertificates
        .filter((c) => c.host.trim() || c.path.trim())
        .map((c) => ({
          host: c.host.trim(),
          path: c.path.trim(),
          keyPath: c.keyPath?.trim() || null,
          password: c.password || null,
        })),
    }),
  });
  if (!response.ok) throw await ApiError.fromResponse(response);
}

/** Ajan doğrularsa uygular ve kaydeder; doğrulamazsa ApiError (mesajda tüm hatalar) fırlatır. */
export async function saveNetworkSettings(settings: NetworkSettings, previousCertCount: number) {
  await applyToAgent(await agentInfo(), settings);
  await persist(settings, previousCertCount);
}

let applied: { url: string; done: Promise<void> } | null = null;
let startupError: string | null = null;

/** Açılışta kayıtlı ayarlar uygulanamadıysa nedeni (ayarlar penceresinde gösterilir). */
export function networkStartupError() {
  return startupError;
}

/**
 * Masaüstünde API istemcisinin kullandığı ajan bilgisi. Her ajan için ilk istekten önce kayıtlı proxy/SSL
 * ayarları uygulanır; böylece hiçbir istek ayarlar uygulanmadan gitmez.
 */
export async function localAgentWithSettings(): Promise<LocalAgent> {
  const agent = await agentInfo();
  if (applied?.url !== agent.url) {
    startupError = null;
    applied = {
      url: agent.url,
      done: loadNetworkSettings()
        .then((settings) => applyToAgent(agent, settings))
        .catch((error: unknown) => {
          startupError = error instanceof Error ? error.message : String(error);
        }),
    };
  }
  await applied.done;
  return agent;
}
