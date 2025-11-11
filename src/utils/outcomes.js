import { FALLBACK_BRANDS, TEAM_THEMES } from '@/constants/teamThemes.js';

const normalise = (value) => String(value ?? '').trim().toLowerCase();

const deriveAbbreviation = (label) => {
  const cleaned = String(label ?? '').replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
  if (!cleaned) {
    return '—';
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }
  const initials = words
    .slice(0, 3)
    .map((word) => word[0])
    .join('');
  return initials.toUpperCase();
};

export const resolveOutcomeIdentity = (outcome, { fallbackIndex = 0 } = {}) => {
  const label = outcome?.label ?? outcome?.name ?? 'Outcome';
  const baseAbbreviation = outcome?.abbreviation ?? deriveAbbreviation(label);
  const labelKey = normalise(label);
  const abbreviationKey = normalise(baseAbbreviation);

  const theme = TEAM_THEMES.find((candidate) => {
    if (!candidate) {
      return false;
    }
    if (normalise(candidate.abbreviation) === abbreviationKey && abbreviationKey) {
      return true;
    }
    return candidate.keywords?.some((keyword) => labelKey.includes(normalise(keyword)));
  });

  const fallbackBrand = FALLBACK_BRANDS[fallbackIndex % FALLBACK_BRANDS.length] ?? FALLBACK_BRANDS[0];

  const primaryColor = outcome?.color ?? theme?.primaryColor ?? fallbackBrand.primaryColor;
  const secondaryColor = theme?.secondaryColor ?? fallbackBrand.secondaryColor;

  return {
    label,
    abbreviation: (theme?.abbreviation ?? baseAbbreviation ?? '???').toUpperCase(),
    primaryColor,
    secondaryColor,
    displayName: theme?.displayName ?? label,
  };
};
