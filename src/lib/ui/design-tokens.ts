export const DESIGN_TOKENS = {
  radius: { sm: "8px", md: "12px", lg: "18px", xl: "24px", pill: "999px" },
  spacing: { xs: "4px", sm: "8px", md: "12px", lg: "20px", xl: "32px", "2xl": "48px" },
  typography: {
    display: "clamp(2rem, 5vw, 4rem)",
    h1: "clamp(1.75rem, 4vw, 3rem)",
    h2: "clamp(1.4rem, 3vw, 2.25rem)",
    body: "1rem",
    small: "0.875rem",
  },
  motion: {
    fast: "120ms",
    normal: "220ms",
    slow: "360ms",
  },
} as const;

export const Z_INDEX = {
  base: 0,
  dropdown: 20,
  sticky: 30,
  overlay: 50,
  modal: 60,
  toast: 70,
} as const;
