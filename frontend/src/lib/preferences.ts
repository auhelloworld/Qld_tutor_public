import type { Subject, YearLevel } from './api-types';

export type Locale = 'en-AU' | 'en-US';

const LOCALE_KEY = 'qld_tutor_locale';
const SUBJECT_KEY = 'qld_tutor_subject';
const YEAR_KEY = 'qld_tutor_year';
const SENIOR_PREVIEW_KEY = 'qld_tutor_senior_preview';
const NAV_VIEW_KEY = 'qld_tutor_nav_view';

export type NavView = 'learning' | 'strands';

export function getNavView(): NavView {
  if (typeof window === 'undefined') return 'learning';
  return localStorage.getItem(NAV_VIEW_KEY) === 'strands' ? 'strands' : 'learning';
}

export function setNavView(view: NavView): void {
  if (typeof window !== 'undefined') localStorage.setItem(NAV_VIEW_KEY, view);
}

export function getLocale(): Locale {
  if (typeof window === 'undefined') return 'en-AU';
  const stored = localStorage.getItem(LOCALE_KEY);
  return stored === 'en-US' ? 'en-US' : 'en-AU';
}

export function setLocale(locale: Locale): void {
  if (typeof window !== 'undefined') localStorage.setItem(LOCALE_KEY, locale);
}

export function getSubject(): Subject {
  if (typeof window === 'undefined') return 'math';
  const stored = localStorage.getItem(SUBJECT_KEY)?.trim();
  if (stored) return stored as Subject;
  return 'math';
}

export function setSubject(subject: Subject): void {
  if (typeof window !== 'undefined') localStorage.setItem(SUBJECT_KEY, subject);
}

export function getYear(): YearLevel {
  if (typeof window === 'undefined') return 'year7';
  const stored = localStorage.getItem(YEAR_KEY)?.trim();
  if (stored && (/^year(7|8|9|10)$/.test(stored) || /^unit(1|2|3|4)$/.test(stored))) {
    return stored as YearLevel;
  }
  return 'year7';
}

export function setYear(year: YearLevel): void {
  if (typeof window !== 'undefined') localStorage.setItem(YEAR_KEY, year);
}

export function getSeniorPreview(): string[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(SENIOR_PREVIEW_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function setSeniorPreview(subjects: string[]): void {
  if (typeof window !== 'undefined') localStorage.setItem(SENIOR_PREVIEW_KEY, JSON.stringify(subjects));
}
