import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('exam exit keepalive API', () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });
  });

  it('queues a small delta with synchronous student authentication', async () => {
    const { examSaveOnExit } = await import('../lib/api');
    localStorage.setItem('qld_tutor_student_token', 'eyJcached-token');

    expect(examSaveOnExit(
      'exam-keepalive',
      { responses: { q1: 'latest' }, current_index: 2, flagged: ['q1'] },
      'english',
    )).toBe(true);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/exam/save');
    expect(options.keepalive).toBe(true);
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer eyJcached-token');
    expect(JSON.parse(options.body)).toEqual({
      subject: 'english',
      exam_id: 'exam-keepalive',
      responses: { q1: 'latest' },
      current_index: 2,
      flagged: ['q1'],
    });
  });

  it('refuses an oversized body before calling fetch', async () => {
    const { examSaveOnExit, EXAM_KEEPALIVE_MAX_BYTES } = await import('../lib/api');

    expect(examSaveOnExit(
      'exam-too-large',
      { responses: { q1: 'x'.repeat(EXAM_KEEPALIVE_MAX_BYTES) } },
    )).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
