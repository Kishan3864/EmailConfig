import type { Config } from "tailwindcss";

// Compact type scale: the whole app reads smaller and denser, like desktop software.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["10.5px", { lineHeight: "14px" }],
        xs: ["11.5px", { lineHeight: "16px" }],
        sm: ["12.5px", { lineHeight: "18px" }],
        base: ["13.5px", { lineHeight: "20px" }],
        lg: ["15px", { lineHeight: "22px" }],
        xl: ["17px", { lineHeight: "24px" }],
        "2xl": ["20px", { lineHeight: "28px" }],
        "3xl": ["24px", { lineHeight: "30px" }],
      },
      colors: { canvas: "#f5f6f8" },
      boxShadow: {
        card: "0 1px 2px 0 rgb(16 24 40 / 0.04)",
        pop: "0 12px 32px -8px rgb(16 24 40 / 0.18), 0 4px 8px -4px rgb(16 24 40 / 0.06)",
      },
      keyframes: {
        "toast-in": { from: { opacity: "0", transform: "translateY(-8px) scale(.98)" }, to: { opacity: "1", transform: "none" } },
        "sheet-in": { from: { transform: "translateY(100%)" }, to: { transform: "none" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "pop-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "toast-in": "toast-in .22s cubic-bezier(.2,.8,.2,1)",
        "sheet-in": "sheet-in .26s cubic-bezier(.2,.8,.2,1)",
        "fade-in": "fade-in .2s ease-out",
        "pop-in": "pop-in .16s ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
