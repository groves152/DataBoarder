/** @type {import('tailwindcss').Config} */
// Every color token reads a CSS variable (index.css) so the light / dark theme
// is a class swap on <html> (src/theme.ts). `gray` is remapped too: the
// components' text-gray-* classes are written for "ink on the app surface",
// and the light theme inverts the ramp so they stay legible.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: v("c-surface"),
        panel: v("c-panel"),
        border: v("c-border"),
        accent: v("c-accent"),
        warn: v("c-warn"),
        info: v("c-info"),
        gray: Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((k) => [k, v(`g-${k}`)])),
      },
    },
  },
  plugins: [],
};
