import type { Config } from 'tailwindcss';

// Design tokens — "modern fashion/lifestyle brand tool" direction.
// Base: warm cream canvas + near-black ink (never pure white/black).
// Accents: blush (primary), mint (secondary), coral (signature/CTA), lavender (sparing, gradients only).
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: '#FBF7F2', // warm cream base
          alt: '#F3EEE5', // section-alternate warm grey-cream
          card: '#FFFFFF',
        },
        ink: {
          DEFAULT: '#241F1B', // near-black warm ink, body/heading text
          soft: '#5C554E', // secondary text
          faint: '#9A9188', // tertiary / placeholder text
        },
        blush: {
          50: '#FCF1F0',
          100: '#F7DEDC',
          300: '#EEB8B4',
          500: '#E29B95', // primary accent
          600: '#CE7C76',
          700: '#B25F5A',
        },
        mint: {
          50: '#F1F7F2',
          100: '#DCEBE0',
          300: '#B7D6BF',
          500: '#8FBB9C', // secondary accent
          600: '#6FA07E',
        },
        coral: {
          400: '#EA8B68',
          500: '#E07049', // signature accent — primary CTA
          600: '#C65A36',
        },
        lavender: {
          200: '#E4DCF3',
          400: '#C3AFE3', // sparing use — gradients / highlights only
        },
        // Bold DTC/editorial accent set — OWBRAND_MASTER_CLAUDE_BUILD_PROMPT §4.
        // Additive to the palette above (nothing above is removed or renamed).
        // Use ONE dominant accent per page/context — never combine several here
        // in one composition. `coral` above remains the signature/CTA accent
        // (it already carries the brand's orange-red identity); the set below
        // exists for marketing/editorial surfaces that need a different single
        // dominant accent (e.g. a campaign-themed section or brand-colored UI).
        pink: {
          400: '#FF6FA5',
          500: '#FF4394',
          600: '#E12E7D',
        },
        sun: {
          400: '#FFC94A',
          500: '#FFB800',
          600: '#E6A200',
        },
        fresh: {
          400: '#4ADE80',
          500: '#22C55E',
          600: '#16A34A',
        },
        cyan: {
          400: '#33D6E0',
          500: '#0FB8C4',
          600: '#0C93A6',
        },
        cobalt: {
          400: '#4C7DFF',
          500: '#2E5BFF',
          600: '#1E42D6',
        },
        violet: {
          400: '#A76BFF',
          500: '#8B3EFF',
          600: '#6F26D6',
        },
        line: '#E7E0D6', // hairline borders on cream
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
      borderRadius: {
        xl: '1.25rem',
        '2xl': '1.75rem',
        '3xl': '2.25rem',
      },
      boxShadow: {
        soft: '0 2px 8px rgba(36, 31, 27, 0.04), 0 12px 32px rgba(36, 31, 27, 0.06)',
        glass: '0 1px 1px rgba(255,255,255,0.6) inset, 0 8px 30px rgba(36, 31, 27, 0.08)',
        pop: '0 8px 24px rgba(224, 112, 73, 0.25)',
      },
      backgroundImage: {
        'aurora-soft': 'radial-gradient(60% 60% at 20% 20%, rgba(226,155,149,0.25) 0%, rgba(226,155,149,0) 60%), radial-gradient(50% 50% at 85% 15%, rgba(143,187,156,0.22) 0%, rgba(143,187,156,0) 60%), radial-gradient(60% 60% at 60% 90%, rgba(195,175,227,0.18) 0%, rgba(195,175,227,0) 60%)',
      },
      keyframes: {
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'reveal-up': {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0) rotate(var(--tilt, 0deg))' },
          '50%': { transform: 'translateY(-10px) rotate(var(--tilt, 0deg))' },
        },
      },
      animation: {
        marquee: 'marquee 38s linear infinite',
        'reveal-up': 'reveal-up 0.7s cubic-bezier(0.16,1,0.3,1) both',
        float: 'float 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
