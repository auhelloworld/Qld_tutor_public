'use client';

import { getStudentId } from '../../lib/student_id';

interface Student {
  student_id: string;
  display_name?: string;
  subjects: string[];
}

interface StudentManagementProps {
  students: Student[];
  listError: string;
  deleting: string | null;
  deleteBusy: boolean;
  onSwitchToStudent: (student: Student) => void;
  onDeleteStudent: (student: Student) => void;
}

export default function StudentManagement({
  students,
  listError,
  deleting,
  deleteBusy,
  onSwitchToStudent,
  onDeleteStudent,
}: StudentManagementProps) {
  const currentId = getStudentId();

  return (
    <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>👨‍👩‍👧‍👦 Student profiles</h2>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: '1.4' }}>
        Switch which student this browser is managing, or permanently delete a profile&apos;s logs, progress, database records and registered login.
        After switching you will need to unlock the parent dashboard again for the new student.
        Delete cannot be undone.
      </p>

      {listError && (
        <div style={{ fontSize: '13px', color: '#ef4444', padding: '8px 12px', marginBottom: '12px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px' }}>
          Error: {listError}. Make sure the backend server is running.
        </div>
      )}

      {students.length === 0 ? (
        <div style={{ fontSize: '14px', color: 'var(--text-secondary)', padding: '12px 0' }}>
          No students found. Data appears after students practise.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {students.map((s) => (
            <div key={s.student_id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', borderRadius: '10px',
              background: s.student_id === currentId ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.4)',
              border: `1px solid ${s.student_id === currentId ? 'rgba(99,102,241,0.3)' : 'var(--border-color)'}`,
              gap: '12px', flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '15px', fontWeight: '600' }}>
                  {s.display_name || 'Unnamed'}
                </span>
                <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                  {s.student_id.slice(0, 8)}…
                </span>
                {s.student_id === currentId && (
                  <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--accent-color)', background: 'rgba(99,102,241,0.12)', padding: '2px 6px', borderRadius: '4px' }}>
                    current
                  </span>
                )}
                {s.subjects.length > 0 && (
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', background: 'rgba(99,102,241,0.1)', padding: '2px 8px', borderRadius: '4px' }}>
                    {s.subjects.join(', ')}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {s.student_id !== currentId && (
                  <button
                    type="button"
                    disabled={deleteBusy}
                    onClick={() => onSwitchToStudent(s)}
                    style={{
                      padding: '6px 14px', fontSize: '12px', fontWeight: '600', borderRadius: '6px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                      background: 'rgba(99,102,241,0.12)', color: 'var(--accent-color)',
                      transition: 'all 0.2s',
                    }}
                  >
                    Switch to
                  </button>
                )}
                <button
                  type="button"
                  disabled={deleteBusy}
                  aria-busy={deleteBusy && deleting === s.student_id}
                  aria-label={`${deleting === s.student_id ? 'Confirm deletion of' : 'Delete'} ${s.display_name || s.student_id.slice(0, 8)}`}
                  onClick={() => onDeleteStudent(s)}
                  style={{
                    padding: '6px 14px', fontSize: '12px', fontWeight: '600', borderRadius: '6px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                    background: deleting === s.student_id ? '#dc2626' : 'rgba(220,38,38,0.1)',
                    color: deleting === s.student_id ? '#fff' : '#dc2626',
                    transition: 'all 0.2s',
                  }}
                >
                  {deleting === s.student_id ? 'Confirm Delete' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
