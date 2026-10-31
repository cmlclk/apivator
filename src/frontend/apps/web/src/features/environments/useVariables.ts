import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  buildVariableMap,
  type CollectionTreeDto,
  type VariableMap,
  type VariableScope,
} from '@apivator/core';
import { api } from '../../lib/api';
import { scopeKeys, useEnvironmentStore } from './environmentStore';

export const environmentsQueryKey = (workspaceId: string | undefined) =>
  ['environments', workspaceId] as const;
export const globalsQueryKey = (workspaceId: string | undefined) => ['globals', workspaceId] as const;

export function useEnvironments(workspaceId: string | undefined) {
  return useQuery({
    queryKey: environmentsQueryKey(workspaceId),
    queryFn: () => api.environments.list(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

export function useGlobals(workspaceId: string | undefined) {
  return useQuery({
    queryKey: globalsQueryKey(workspaceId),
    queryFn: () => api.globals.get(workspaceId!),
    enabled: Boolean(workspaceId),
  });
}

/** Aktif environment (silinmişse null). */
export function useActiveEnvironment(workspaceId: string | undefined) {
  const { data: environments = [] } = useEnvironments(workspaceId);
  const activeId = useEnvironmentStore((s) => (workspaceId ? (s.active[workspaceId] ?? null) : null));
  return environments.find((e) => e.id === activeId) ?? null;
}

export interface VariableScopes {
  scopes: VariableScope[];
  /** Kapsam → yerel güncel değerlerin saklandığı anahtar (environmentStore). */
  keys: { environment?: string; collection?: string; globals?: string };
  environmentName: string | null;
}

/** İstek için geçerli değişken kapsamları: aktif environment, isteğin collection'ı, globals. */
export function useVariableScopes(
  workspaceId: string | undefined,
  collection: CollectionTreeDto | undefined,
): VariableScopes {
  const environment = useActiveEnvironment(workspaceId);
  const { data: globals } = useGlobals(workspaceId);
  const currentValues = useEnvironmentStore((s) => s.currentValues);

  return useMemo(() => {
    const scopes: VariableScope[] = [];
    const keys: VariableScopes['keys'] = {};
    if (environment) {
      keys.environment = scopeKeys.environment(environment.id);
      scopes.push({
        kind: 'environment',
        name: environment.name,
        variables: environment.variables,
        current: currentValues[keys.environment] ?? {},
      });
    }
    if (collection) {
      keys.collection = scopeKeys.collection(collection.id);
      scopes.push({
        kind: 'collection',
        name: collection.name,
        variables: collection.variables ?? [],
        current: currentValues[keys.collection] ?? {},
      });
    }
    if (globals && workspaceId) {
      keys.globals = scopeKeys.globals(workspaceId);
      scopes.push({
        kind: 'global',
        name: 'Globals',
        variables: globals.variables,
        current: currentValues[keys.globals] ?? {},
      });
    }
    return { scopes, keys, environmentName: environment?.name ?? null };
  }, [environment, collection, globals, workspaceId, currentValues]);
}

/** İstek için geçerli değişken haritası: aktif environment > isteğin collection'ı > globals. */
export function useVariableMap(
  workspaceId: string | undefined,
  collection: CollectionTreeDto | undefined,
): VariableMap {
  const { scopes } = useVariableScopes(workspaceId, collection);
  return useMemo(() => buildVariableMap(scopes), [scopes]);
}
