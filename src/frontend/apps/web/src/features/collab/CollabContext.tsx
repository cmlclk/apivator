import { createContext, useContext } from 'react';
import type { CollabSession } from './CollabSession';

/** Etkin sekmenin canlı ortak düzenleme oturumu (yoksa null); editörler imleç ve odak için kullanır. */
export const CollabSessionContext = createContext<CollabSession | null>(null);

export const useCollabSession = () => useContext(CollabSessionContext);
