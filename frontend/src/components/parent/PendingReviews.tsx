import MathMarkdown from '../MathMarkdown';
import QuestionContext from '../QuestionContext';

interface PendingReviewsProps {
  reviews: any[];
  reviewing: string | null;
  parentSubject: string;
  onReview: (review: any, correct: boolean) => void;
}

function reviewIdentity(review: any): string {
  return review.review_key || `${review.question_id || ''}:${review.part_label || 'whole'}:${review.student_answer || ''}`;
}

export default function PendingReviews({ reviews, reviewing, parentSubject, onReview }: PendingReviewsProps) {
  return (
    <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: '#c084fc' }}>
        📝 Pending Review for {parentSubject} ({reviews.length})
      </h2>
      {reviews.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>No pending reviews for {parentSubject}.</div>
      ) : (
        <>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: '1.4' }}>
            These answers couldn&apos;t be auto-graded. Review each one and approve or reject.
          </p>
          {reviews.map((r) => (
            <div key={reviewIdentity(r)} style={{
              padding: '16px', marginBottom: '12px',
              background: 'rgba(168,85,247,0.05)',
              border: '1px solid rgba(168,85,247,0.2)', borderRadius: '10px',
            }}>
              <div style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: '8px', lineHeight: '1.5' }}>
                <QuestionContext question={r} showSubParts />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                <div style={{ fontSize: '13px' }}>
                  <span style={{ color: '#dc2626', fontWeight: '600' }}>Student: </span>
                  <span style={{ color: 'var(--text-secondary)' }}><MathMarkdown inline>{r.student_answer}</MathMarkdown></span>
                </div>
                <div style={{ fontSize: '13px' }}>
                  <span style={{ color: '#16a34a', fontWeight: '600' }}>Correct: </span>
                  <span style={{ color: 'var(--text-secondary)' }}><MathMarkdown inline>{r.correct_answer}</MathMarkdown></span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Topic: {r.topic} · {r.timestamp ? new Date(r.timestamp).toLocaleString() : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => onReview(r, false)}
                  disabled={reviewing === reviewIdentity(r)}
                  style={{
                    flex: 1, padding: '8px 14px', fontSize: '13px', fontWeight: '600',
                    background: 'rgba(239,68,68,0.12)', color: '#ef4444',
                    border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', cursor: 'pointer',
                    opacity: reviewing === reviewIdentity(r) ? 0.5 : 1,
                  }}
                >Reject</button>
                <button
                  onClick={() => onReview(r, true)}
                  disabled={reviewing === reviewIdentity(r)}
                  style={{
                    flex: 1, padding: '8px 14px', fontSize: '13px', fontWeight: '600',
                    background: 'rgba(34,197,94,0.12)', color: '#16a34a',
                    border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', cursor: 'pointer',
                    opacity: reviewing === reviewIdentity(r) ? 0.5 : 1,
                  }}
                >Approve</button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
