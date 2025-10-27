/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html','./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Helvetica', 'Arial']
      },
      colors: {
        bg:'#0f1115', card:'#161922', stroke:'#1f2430',
        text:'#E6E8EF', sub:'#AAB1C2', primary:'#39BDF8',
        green:'#22c55e', red:'#ef4444', yellow:'#f59e0b'
      },
      borderRadius:{ xl:'14px','2xl':'20px' },
      boxShadow:{ soft:'0 8px 24px rgba(0,0,0,0.35)' }
    }
  },
  plugins: [],
}
