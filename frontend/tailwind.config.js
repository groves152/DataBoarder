/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#0f1117",
        panel: "#1a1d27",
        border: "#2a2d3e",
        accent: "#7c6af7",
      },
    },
  },
  plugins: [],
};
