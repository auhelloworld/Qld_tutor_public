interface ActivityDate {
  date: string;
  active: boolean;
  frozen?: boolean;
}

interface ActivityCalendarProps {
  activityDates: ActivityDate[];
}

export default function ActivityCalendar({ activityDates }: ActivityCalendarProps) {
  if (!activityDates || activityDates.length === 0) return null;
  const dates = activityDates;
  const todayISODate = dates[dates.length - 1]?.date;
  const firstDate = new Date(`${dates[0].date}T00:00:00`);
  const dayOfWeek = (firstDate.getDay() + 6) % 7;
  const pads = Array(dayOfWeek).fill(null);

  return (
    <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>📅 14-Day Activity</h2>
      <div role="grid" aria-label="Activity across all subjects for the last 14 days" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
          <div role="columnheader" key={day} style={{ fontSize: '10px', color: 'var(--text-secondary)', textAlign: 'center', paddingBottom: '4px' }}>{day}</div>
        ))}
        {pads.map((_, index) => <div role="presentation" key={`pad-${index}`} />)}
        {dates.map((entry) => {
          const isToday = entry.date === todayISODate;
          const state = entry.active ? 'studied' : entry.frozen ? 'streak freeze used' : 'no activity';
          return (
            <div
              role="gridcell"
              key={entry.date}
              title={`${entry.date}: ${state}`}
              aria-label={`${entry.date}: ${state}${isToday ? ', today' : ''}`}
              style={{
                height: '28px',
                borderRadius: '4px',
                background: entry.active
                  ? 'rgba(74,222,128,0.7)'
                  : entry.frozen
                    ? 'rgba(59,130,246,0.45)'
                    : 'rgba(255,255,255,0.05)',
                border: isToday ? '1px solid var(--accent-color)' : '1px solid transparent',
                transition: 'background 0.2s',
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
        <span>🟩 Studied</span>
        <span>🟦 Streak freeze</span>
        <span>⬜ No activity</span>
      </div>
    </div>
  );
}
