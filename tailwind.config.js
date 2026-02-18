/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{tsx,ts,html}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#16A34A",
          dark: "#15803D",
        },
      },
    },
  },
  plugins: [],
};
