import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./{app,components}/**/*.{ts,tsx}"],
  safelist: [
    { pattern: /^(bg|text|border)-app-/ },
    "shadow-card",
    "animate-wave",
  ],
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
        app: {
          bg: "var(--bg)",
          surface: "var(--surface)",
          "surface-elevated": "var(--surface-elevated)",
          border: "var(--border)",
          text: "var(--text)",
          muted: "var(--text-muted)",
          subtle: "var(--text-subtle)",
          accent: "var(--accent)",
          "accent-dim": "var(--accent-dim)",
          "accent-muted": "var(--accent-muted)",
          "accent-fg": "var(--accent-foreground)",
          bar: "var(--bar)",
          "bar-active": "var(--bar-active)",
          danger: "var(--danger)",
        },
      },
      boxShadow: {
        card: "0 0 0 1px var(--border)",
      },
      keyframes: {
        wave: {
          "0%, 100%": { transform: "scaleY(0.45)", opacity: "0.65" },
          "50%": { transform: "scaleY(1)", opacity: "1" },
        },
      },
      animation: {
        wave: "wave 0.9s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
