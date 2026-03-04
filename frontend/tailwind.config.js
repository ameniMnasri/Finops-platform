/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#1B5E46",      // Vert foncé TeamWill
        secondary: "#2A8659",    // Vert moyen
        tertiary: "#38A169",     // Vert clair
        accent: "#4CAF50",       // Vert bright TeamWill
        success: "#66BB6A",
        warning: "#FFA726",
        danger: "#EF5350",
        light: "#FFFFFF",
        dark: "#0F2818",
      },
      spacing: {
        gutter: '2rem',
      },
      boxShadow: {
        glow: "0 0 20px rgba(76, 175, 80, 0.25)",
        soft: "0 4px 20px rgba(0, 0, 0, 0.08)",
      },
    },
  },
  plugins: [],
}