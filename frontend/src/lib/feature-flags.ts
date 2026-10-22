export const ENABLE_GUIDED_PRACTICE = process.env.NEXT_PUBLIC_GUIDED_PRACTICE !== 'false';

// Learning Map navigation: discipline/skill-aware grouping as the default
// curriculum view, with the official ACARA/QCAA strands available via a toggle.
export const ENABLE_LEARNING_MAP = process.env.NEXT_PUBLIC_LEARNING_MAP !== 'false';

export const ENABLE_SCIENCE_LAB = process.env.NEXT_PUBLIC_SCIENCE_LAB !== 'false';
