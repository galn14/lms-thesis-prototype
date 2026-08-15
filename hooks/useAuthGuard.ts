'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export function useAuthGuard(role?: string) {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const userData = localStorage.getItem('user');
    if (!userData) {
      router.replace('/login');
      return;
    }

    try {
      const user = JSON.parse(userData);
      if (role && user.role !== role) {
        router.replace('/login');
        return;
      }
    } catch (err) {
      console.error('Invalid user data in localStorage');
      router.replace('/login');
      return;
    }

    setIsChecking(false);
  }, [router, role]);

  return { isChecking };
}
