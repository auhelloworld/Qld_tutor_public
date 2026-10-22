'use client';
import { useEffect, useState } from 'react';
import { getDisplayName, TOKEN_STORAGE_KEY } from '../lib/student_id';
import AuthModal from './AuthModal';

export default function AuthGate() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const existing = getDisplayName();
    const hasToken = !!localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!existing && !hasToken) {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  return <AuthModal onClose={() => setShow(false)} />;
}
