import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export const publicationQueryKey = (collectionId: string) => ['publication', collectionId] as const;

export function usePublication(collectionId: string) {
  return useQuery({
    queryKey: publicationQueryKey(collectionId),
    queryFn: () => api.docs.publication(collectionId),
  });
}
