/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "ui-sans-serif", "system-ui"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      colors: {
        ink: {
          950: "#070b14",
          900: "#0c1222",
          800: "#121a2c",
          700: "#1a2438",
          600: "#243049",
        },
        mist: {
          100: "#e8eef8",
          400: "#8b97b0",
        },
        accent: {
          DEFAULT: "#2dd4bf",
          dim: "#115e59",
        },
      },
    },
  },
  plugins: [],
};
