/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ok: "#4ade80",
        warn: "#fbbf24",
        bad: "#ef4444",
      },
    },
  },
  plugins: [],
};
