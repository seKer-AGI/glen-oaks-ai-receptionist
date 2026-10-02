import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0fafa",
          100: "#d5f2f1",
          500: "#14a3a8",
          600: "#0e868b",
          700: "#0f6b70",
          900: "#0c3f43",
        },
      },
    },
  },
  plugins: [],
};

export default config;
