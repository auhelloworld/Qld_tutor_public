import SandboxTab from './SandboxTab';
import CalculusTab from './CalculusTab';
import type { LabActivityId } from '../../lib/lab-activities';

type AdvancedTab = 'sandbox' | 'calculus';

interface AdvancedMathTabProps {
  tab: AdvancedTab;
  isExact: boolean;
  mafsHeight: number;
  preset?: string;
  mode?: 'explore' | 'learn';
  activityId?: LabActivityId;
  onActivityComplete?: (activityId: string, success: boolean) => void;
  onExitLearn?: () => void;
}

export default function AdvancedMathTab({
  tab,
  isExact,
  mafsHeight,
  preset = '',
  mode = 'explore',
  activityId,
  onActivityComplete,
  onExitLearn,
}: AdvancedMathTabProps) {
  if (tab === 'calculus') {
    return (
      <CalculusTab
        isExact={isExact}
        mafsHeight={mafsHeight}
        preset={preset}
        mode={mode}
        activityId={activityId}
        onActivityComplete={onActivityComplete}
        onExitLearn={onExitLearn}
      />
    );
  }
  return (
    <SandboxTab
      isExact={isExact}
      mafsHeight={mafsHeight}
      preset={preset}
      mode={mode}
      activityId={activityId}
      onActivityComplete={onActivityComplete}
      onExitLearn={onExitLearn}
    />
  );
}
