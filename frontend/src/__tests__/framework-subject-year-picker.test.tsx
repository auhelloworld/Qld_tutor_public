import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FrameworkSubjectYearPicker from '../components/FrameworkSubjectYearPicker';
import { setSubject, setYear } from '../lib/preferences';
import type { Curriculum } from '../lib/curriculum_helpers';

const curriculum = {
  math: { year7: {} },
  english: { year8: {} },
} as unknown as Curriculum;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('FrameworkSubjectYearPicker controlled initial scope', () => {
  it('does not overwrite a valid URL-derived value with stored preferences', async () => {
    setSubject('math');
    setYear('year7');
    const onChange = vi.fn();

    render(
      <FrameworkSubjectYearPicker
        curriculum={curriculum}
        value={{ subject: 'english', year: 'year8' }}
        onChange={onChange}
        initialiseFromPreferences={false}
      />,
    );

    await waitFor(() => expect(onChange).not.toHaveBeenCalled());
  });

  it('labels QCAA senior scopes as Unit rather than Year', async () => {
    const onChange = vi.fn();
    const seniorCurriculum = { senior_methods: { unit1: {} } } as unknown as Curriculum;

    render(
      <FrameworkSubjectYearPicker
        curriculum={seniorCurriculum}
        value={{ subject: 'senior_methods', year: 'unit1' }}
        onChange={onChange}
        initialiseFromPreferences={false}
      />,
    );

    expect(screen.getByLabelText('Unit')).toBeTruthy();
    await waitFor(() => expect(onChange).not.toHaveBeenCalled());
  });
});
