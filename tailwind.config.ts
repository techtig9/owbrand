import type { Config } from 'tailwindcss';

// Design tokens.
//
// PHASE 5 MIGRATION. The frontend specification mandates a deep-indigo
// primary, premium near-white surfaces, charcoal/slate text, cool-gray borders
// and a properly designed dark theme. Those live as CSS custom properties in
// src/styles/tokens.css and are surfaced here as SEMANTIC Tailwind names
// (`bg-surface`, `text-secondary`, `border-default`) that resolve through the
// variables, so switching theme is a token change rather than a class change.
//
// The previous warm-cream palette (canvas / ink / blush / mint / coral) is
// retained below and re-pointed at the new tokens. Roughly 30 screens name
// those colours literally; deleting them would break every one at once, while
// aliasing lets the whole app adopt the new system immediately and each screen
// migrate to semantic names as it is touched. The literal names are deprecated
// and must not be used in new code.
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  /* Class strategy keyed off the same attribute tokens.css uses, so a
     `dark:` utility and a token both respond to one source of truth. */
  darkMode: ['selector', ':root[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
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
        /* --- Semantic tokens: use THESE in new code ------------------- */
        bg: 'var(--color-bg)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          raised: 'var(--color-surface-raised)',
          sunken: 'var(--color-surface-sunken)',
          overlay: 'var(--color-surface-overlay)',
        },
        content: {
          DEFAULT: 'var(--color-text)',
          secondary: 'var(--color-text-secondary)',
          tertiary: 'var(--color-text-tertiary)',
          inverse: 'var(--color-text-inverse)',
        },
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          active: 'var(--color-primary-active)',
          fg: 'var(--color-primary-text)',
          subtle: 'var(--color-primary-subtle)',
          'on-subtle': 'var(--color-primary-on-subtle)',
        },
        success: {
          DEFAULT: 'var(--color-success)',
          subtle: 'var(--color-success-subtle)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          subtle: 'var(--color-warning-subtle)',
        },
        danger: {
          DEFAULT: 'var(--color-danger)',
          subtle: 'var(--color-danger-subtle)',
        },
        info: {
          DEFAULT: 'var(--color-info)',
          subtle: 'var(--color-info-subtle)',
        },
        ai: {
          DEFAULT: 'var(--color-ai)',
          subtle: 'var(--color-ai-subtle)',
        },
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          grid: 'var(--chart-grid)',
          axis: 'var(--chart-axis-text)',
          context: 'var(--chart-context)',
        },

        /* --- Deprecated literal names, re-pointed at the tokens -------- */
        /* Every screen written before Phase 5 uses these. They now resolve to
           the new system, so the app is themed and dark-mode-capable without
           30 simultaneous rewrites. Do not use them in new code. */
        canvas: {
          DEFAULT: 'var(--color-bg)',
          alt: 'var(--color-surface-raised)',
          card: 'var(--color-surface)',
        },
        ink: {
          DEFAULT: 'var(--color-text)',
          soft: 'var(--color-text-secondary)',
          faint: 'var(--color-text-tertiary)',
        },
        line: 'var(--color-border)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
      borderRadius: {
        /* Spec section 13 asks for 12-16px on cards. The old xl/2xl/3xl were
           20/28/36px, which reads as consumer-app rounding rather than the
           product discipline the spec targets. */
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-lg)',
        '2xl': 'var(--radius-lg)',
        '3xl': 'var(--radius-xl)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        focus: 'var(--shadow-focus)',
        /* Deprecated aliases, so existing screens keep working. */
        soft: 'var(--shadow-sm)',
        glass: 'var(--shadow-lg)',
        pop: 'var(--shadow-md)',
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
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        /* Transform and opacity only: both are compositor-friendly, which is
           what spec section 18 means by GPU-friendly transforms. */
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      transitionDuration: {
        micro: 'var(--duration-micro)',
        standard: 'var(--duration-standard)',
        complex: 'var(--duration-complex)',
      },
      transitionTimingFunction: {
        'ease-out-soft': 'var(--ease-out)',
      },
      animation: {
        marquee: 'marquee 38s linear infinite',
        /* Was 0.7s, well outside the spec's 220-350ms complex band. */
        'reveal-up': 'reveal-up var(--duration-complex) var(--ease-out) both',
        float: 'float 6s ease-in-out infinite',
        'fade-in': 'fade-in var(--duration-standard) var(--ease-out) both',
        'scale-in': 'scale-in var(--duration-standard) var(--ease-out) both',
        'slide-up': 'slide-up var(--duration-complex) var(--ease-out) both',
      },
    },
  },
  plugins: [],
};

export default config;
