/** Organizasyonun denetim kaydındaki bir olay (sunucudaki AuditEntryDto). */
export interface AuditEntryDto {
  id: string;
  createdAt: string;
  /** Kararlı olay kodu, ör. "member.role_changed". */
  action: string;
  actorId: string | null;
  actorName: string;
  actorEmail: string | null;
  viaApiKey: boolean;
  ipAddress: string | null;
  device: string | null;
  targetType: string;
  targetId: string | null;
  targetName: string;
  workspaceId: string | null;
  workspaceName: string | null;
  data: Record<string, string>;
}

export interface AuditPageDto {
  items: AuditEntryDto[];
  nextCursor: string | null;
  /** 0 ise kayıtlar silinmez. */
  retentionDays: number;
}

export interface AuditFilter {
  from?: string;
  to?: string;
  /** Tam kod ("member.removed") ya da kategori ("member"). */
  action?: string;
  actorId?: string;
  workspaceId?: string;
  q?: string;
}

/** Filtreyi sorgu dizesine çevirir (boş alanlar atlanır). */
export function auditQuery(filter: AuditFilter, extra: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filter, ...extra })) {
    if (value) params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}
