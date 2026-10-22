'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import TodayPractice from '../../../components/TodayPractice';
import { getSubject, getYear } from '../../../lib/preferences';
import { todayPracticeScope, type TodayPracticeScope } from '../../../lib/today-practice';

/** One page for every Today practice step. The link names the step; the plan says what to ask. */
export default function TodayPracticePage() {
  const [scope, setScope] = useState<TodayPracticeScope | null>(null);

  useEffect(() => {
    setScope(todayPracticeScope(new URLSearchParams(window.location.search), {
      subject: getSubject(),
      year: getYear(),
    }));
  }, []);

  useEffect(() => {
    document.title = 'Today’s Study practice — QLD AI Tutor';
    return () => { document.title = 'QLD AI Tutor'; };
  }, []);

  if (!scope) {
    return <div className="glass-panel" role="status" style={{ maxWidth: '820px', margin: '24px auto', padding: '28px', textAlign: 'center' }}>Loading…</div>;
  }
  if (!scope.taskId) {
    return (
      <div className="glass-panel" style={{ maxWidth: '820px', margin: '24px auto', padding: '28px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '20px', marginTop: 0 }}>No step was chosen</h1>
        <Link href={scope.returnHref} className="btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
          Back to Today’s Study
        </Link>
      </div>
    );
  }
  return <TodayPractice key={scope.taskId} {...scope} taskId={scope.taskId} />;
}
