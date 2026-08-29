export const ACCESSIBILITY_RULES = [
  "All interactive controls must have accessible names.",
  "Keyboard navigation must reach every interactive element.",
  "Focus indicators must remain visible.",
  "Dialogs must trap focus and restore it when closed.",
  "Images need meaningful alt text unless decorative.",
  "Color must never be the only way to communicate status.",
  "Form errors must be associated with their fields.",
  "Motion should respect prefers-reduced-motion.",
  "Touch targets should be comfortably tappable on mobile.",
  "Charts must provide a text summary or data alternative.",
] as const;
