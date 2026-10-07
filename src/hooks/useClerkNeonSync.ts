import { useEffect, useState } from 'react';
import { useUser } from '@clerk/clerk-react';
import { NeonService, NeonUserRecord } from '../services/neonService';
import { UserRole } from '../types/domain';

export function useClerkNeonSync(activeRole: UserRole) {
  const { user, isLoaded, isSignedIn } = useUser();
  const [syncedUser, setSyncedUser] = useState<NeonUserRecord | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;

    const email = user.primaryEmailAddress?.emailAddress;
    if (!email) return;

    let isMounted = true;
    setIsSyncing(true);

    NeonService.syncClerkUser({
      clerkId: user.id,
      email,
      fullName: user.fullName || user.username || email.split('@')[0],
      role: activeRole,
    })
      .then((record) => {
        if (isMounted && record) {
          setSyncedUser(record);
        }
      })
      .finally(() => {
        if (isMounted) setIsSyncing(false);
      });

    return () => {
      isMounted = false;
    };
  }, [user, isLoaded, isSignedIn, activeRole]);

  return {
    clerkUser: user,
    syncedUser,
    isSyncing,
    isSignedIn,
  };
}
