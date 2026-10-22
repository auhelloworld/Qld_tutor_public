import QuestionContext from '../QuestionContext';
import type { DiagnosticQuestion, Exercise } from '../../lib/api-types';

interface QuestionDisplayProps {
  exercise: Exercise | DiagnosticQuestion;
  showSubParts?: boolean;
}

export default function QuestionDisplay({ exercise: ex, showSubParts = false }: QuestionDisplayProps) {
  const complexity = 'complexity' in ex ? ex.complexity : undefined;

  return (
    <div style={{ background: 'rgba(255,255,255,0.05)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          {ex.difficulty && (
            <span>
              {ex.difficulty === 'foundational' ? 'Foundational' : ex.difficulty === 'developing' ? 'Developing' : ex.difficulty === 'extending' ? 'Extension' : 'AMC'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {ex.question_type && ex.question_type !== 'short_answer' && (
            <span style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '10px',
              fontWeight: '600',
              background: ex.question_type === 'multiple_choice'
                ? 'rgba(59, 130, 246, 0.15)' : 'rgba(168, 85, 247, 0.15)',
              color: ex.question_type === 'multiple_choice'
                ? '#60a5fa' : '#c084fc',
              border: `1px solid ${ex.question_type === 'multiple_choice'
                ? 'rgba(59, 130, 246, 0.3)' : 'rgba(168, 85, 247, 0.3)'}`,
            }}>
              {ex.question_type === 'multiple_choice' ? '📋 MCQ' : '📝 Reasoning'}
            </span>
          )}
          {complexity && (
            <span style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '10px',
              fontWeight: '600',
              background: complexity === 'simple_familiar'
                ? 'rgba(34, 197, 94, 0.15)'
                : complexity === 'complex_familiar'
                  ? 'rgba(251, 191, 36, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: complexity === 'simple_familiar'
                ? '#16a34a'
                : complexity === 'complex_familiar'
                  ? '#d97706' : '#dc2626',
              border: `1px solid ${complexity === 'simple_familiar'
                ? 'rgba(34, 197, 94, 0.3)'
                : complexity === 'complex_familiar'
                  ? 'rgba(251, 191, 36, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            }}>
              {complexity === 'simple_familiar' ? '🟢 Simple Familiar (SF)'
                : complexity === 'complex_familiar' ? '🟡 Complex Familiar (CF)'
                  : '🔴 Complex Unfamiliar (CU)'}
            </span>
          )}
        </div>
      </div>
      <QuestionContext question={ex} showSubParts={showSubParts} />
    </div>
  );
}
