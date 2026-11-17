import type { UserRole } from '../types/domain';

/**
 * Compatibility hook only. Clerk-to-Neon user synchronization is disabled;
 * client claims must never create a local identity or assign an application role.
 */
export function useClerkNeonSync(_activeRole?: UserRole) {
  return {
    clerkUser: null,
    syncedUser: null,
    isSyncing: false,
    isSignedIn: false,
  } as const;
}
