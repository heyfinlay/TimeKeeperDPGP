export const TRACK_STATUS_OPTIONS = [
  {
    id: 'green',
    label: 'Green Flag',
    shortLabel: 'Green',
    controlClass:
      'bg-emerald-600 hover:bg-emerald-500 focus-visible:ring-emerald-400',
    bannerClass:
      'border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 shadow-[0_0_40px_rgba(16,185,129,0.35)]',
    description: 'Track clear. Full racing speed permitted.',
    icon: 'flag',
  },
  {
    id: 'yellow_s1',
    label: 'Yellow Flag – Sector 1',
    shortLabel: 'Yellow S1',
    controlClass:
      'bg-amber-400 text-black hover:bg-amber-300 focus-visible:ring-amber-300',
    bannerClass:
      'border border-amber-300/50 bg-amber-400/20 text-amber-100 shadow-[0_0_40px_rgba(251,191,36,0.35)]',
    description: 'Caution in sector 1. Slow down, no overtaking.',
    icon: 'alert',
  },
  {
    id: 'yellow_s2',
    label: 'Yellow Flag – Sector 2',
    shortLabel: 'Yellow S2',
    controlClass:
      'bg-amber-400 text-black hover:bg-amber-300 focus-visible:ring-amber-300',
    bannerClass:
      'border border-amber-300/50 bg-amber-400/20 text-amber-100 shadow-[0_0_40px_rgba(251,191,36,0.35)]',
    description: 'Caution in sector 2. Slow down, no overtaking.',
    icon: 'alert',
  },
  {
    id: 'yellow_s3',
    label: 'Yellow Flag – Sector 3',
    shortLabel: 'Yellow S3',
    controlClass:
      'bg-amber-400 text-black hover:bg-amber-300 focus-visible:ring-amber-300',
    bannerClass:
      'border border-amber-300/50 bg-amber-400/20 text-amber-100 shadow-[0_0_40px_rgba(251,191,36,0.35)]',
    description: 'Caution in sector 3. Slow down, no overtaking.',
    icon: 'alert',
  },
  {
    id: 'vsc',
    label: 'Virtual Safety Car',
    shortLabel: 'VSC',
    controlClass:
      'bg-cyan-500 text-black hover:bg-cyan-400 focus-visible:ring-cyan-300',
    bannerClass:
      'border border-cyan-300/60 bg-cyan-500/20 text-cyan-100 shadow-[0_0_40px_rgba(6,182,212,0.35)]',
    description: 'Maintain delta. Speed reduced across the circuit.',
    icon: 'gauge',
  },
  {
    id: 'sc',
    label: 'Safety Car',
    shortLabel: 'Safety Car',
    controlClass:
      'bg-amber-600 hover:bg-amber-500 focus-visible:ring-amber-400',
    bannerClass:
      'border border-amber-400/50 bg-amber-500/20 text-amber-100 shadow-[0_0_40px_rgba(217,119,6,0.35)]',
    description: 'Safety car deployed. Follow the safety car, no overtaking.',
    icon: 'car',
  },
  {
    id: 'red',
    label: 'Red Flag',
    shortLabel: 'Red Flag',
    controlClass:
      'bg-rose-600 hover:bg-rose-500 focus-visible:ring-rose-400',
    bannerClass:
      'border border-rose-400/50 bg-rose-500/20 text-rose-100 shadow-[0_0_40px_rgba(244,63,94,0.35)]',
    description: 'Session suspended. Cars must return to the pit lane.',
    icon: 'stop',
  },
];

export const TRACK_STATUS_MAP = TRACK_STATUS_OPTIONS.reduce((acc, status) => {
  acc[status.id] = status;
  return acc;
}, {});
