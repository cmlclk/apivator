import { msg } from './i18n';
/** RFC 9457 ProblemDetails yanıtından üretilen hata. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /** Alan bazlı doğrulama hataları; anahtarlar küçük harfle normalize edilir (ör. `email`). */
  readonly fieldErrors: Record<string, string[]>;

  constructor(status: number, message: string, code?: string, fieldErrors: Record<string, string[]> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }

  fieldError(field: string): string | undefined {
    return this.fieldErrors[field.toLowerCase()]?.[0];
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    const problem = (typeof body === 'object' && body !== null ? body : {}) as {
      detail?: string;
      title?: string;
      code?: string;
      errors?: Record<string, string[]>;
    };

    const fieldErrors: Record<string, string[]> = {};
    for (const [key, messages] of Object.entries(problem.errors ?? {})) {
      fieldErrors[key.toLowerCase()] = messages;
    }

    // Uygulamanın kendi 404'leri her zaman bir "code" taşır. Taşımıyorsa uç nokta sunucuda yok demektir;
    // çoğunlukla web arayüzü güncellendi ama API eski sürümle çalışmaya devam ediyor.
    const missingEndpoint = response.status === 404 && !problem.code;
    const message = missingEndpoint
      ? msg(
          'core.errors.unknownEndpoint',
          'Sunucu bu isteği tanımıyor (404). API güncel değilse yeniden başlatın.',
        )
      : (problem.detail ?? problem.title ?? defaultMessage(response.status));
    return new ApiError(response.status, message, problem.code, fieldErrors);
  }
}

function defaultMessage(status: number): string {
  if (status === 429) return msg('core.errors.tooMany', 'Çok fazla istek gönderildi. Lütfen biraz bekleyin.');
  if (status >= 500) return msg('core.errors.server', 'Sunucuda bir hata oluştu. Lütfen tekrar deneyin.');
  return msg('core.errors.default', 'İstek tamamlanamadı.');
}

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(msg('core.errors.network', 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.'), { cause });
    this.name = 'NetworkError';
  }
}

/** Masaüstünde yerel yürütme ajanına ulaşılamadı. */
export class AgentError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'AgentError';
  }
}
