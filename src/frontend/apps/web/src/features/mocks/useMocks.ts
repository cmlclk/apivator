import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import type { MockServerDto } from '@apivator/core';
import { api } from '../../lib/api';
import { serverUrl } from '../../lib/serverUrl';

export const mocksQueryKey = (workspaceId: string | undefined) => ['mocks', workspaceId] as const;
export const mockCallsQueryKey = (mockId: string) => ['mock-calls', mockId] as const;

export function useMocks(workspaceId: string | undefined) {
  return useQuery({
    queryKey: mocksQueryKey(workspaceId),
    queryFn: () => api.mocks.list(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

/** Mock'un tam adresi (masaüstünde ayarlı sunucu, web'de sayfanın kendi adresi). */
export function mockUrl(
  mock: Pick<MockServerDto, 'path'>,
  base = serverUrl() || window.location.origin,
): string {
  return `${base.replace(/\/+$/, '')}${mock.path}`;
}

/** `:id`, `{id}` ve `{{id}}` parçalarını örnek bir değerle doldurur (kopyalanacak komut için). */
export function samplePath(path: string): string {
  return path.replace(/\/(:[^/?]+|\{\{[^}]+\}\}|\{[^}]+\})/g, '/1');
}

/** Mock'u çağırmak için örnek curl komutu. */
export function mockCurl(
  mock: Pick<MockServerDto, 'path' | 'isPrivate'>,
  examplePath = '/',
  base?: string,
  method = 'GET',
): string {
  const url = `${mockUrl(mock, base)}${examplePath.startsWith('/') ? examplePath : `/${examplePath}`}`;
  const verb = method.toUpperCase() === 'GET' ? '' : `-X ${method.toUpperCase()} `;
  const quoted = /[?&\s]/.test(url) ? `"${url}"` : url;
  return mock.isPrivate
    ? `curl ${verb}${quoted} \\\n  -H "x-api-key: $APIVATOR_API_KEY"`
    : `curl ${verb}${quoted}`;
}

/** Collection menüsünden oluşturulan mock'un ayrıntısını Mock'lar panelinde açmak için. */
export const useMockUi = create<{ openMockId: string | null; open: (id: string | null) => void }>((set) => ({
  openMockId: null,
  open: (openMockId) => set({ openMockId }),
}));
