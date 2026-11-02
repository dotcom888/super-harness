/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          '"Inter"',
          "Roboto",
          '"Helvetica Neue"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          "sans-serif"
        ],
        mono: [
          "ui-monospace",
          '"SF Mono"',
          '"Cascadia Code"',
          '"Cascadia Mono"',
          '"Segoe UI Mono"',
          "Menlo",
          "Monaco",
          "Consolas",
          '"Liberation Mono"',
          '"Courier New"',
          "monospace"
        ]
      },
      colors: {
        harness: {
          bg: "#ffffff",
          sidebar: "#f9fafb",
          border: "#e5e7eb",
          hover: "#f3f4f6",
          active: "#e5e7eb",
          accent: "#2563eb",
          text: "#111827",
          muted: "#6b7280"
        }
      }
    }
  },
  plugins: []
}
