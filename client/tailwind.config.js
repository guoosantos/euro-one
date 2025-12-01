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
        green:'#22c55e', red:'#ef4444', yellow:'#f59e0b',
        glass: {
          dark: 'rgba(15, 23, 42, 0.7)',
          light: 'rgba(255, 255, 255, 0.82)'
        }
      },
      borderRadius:{ xl:'14px','2xl':'20px' },
      boxShadow:{
        soft:'0 8px 24px rgba(0,0,0,0.35)',
        glass:'0 20px 60px rgba(0,0,0,0.45)',
        glow:'0 0 0 1px rgba(57, 189, 248, 0.25), 0 15px 45px rgba(57, 189, 248, 0.15)'
      },
      backgroundImage: {
        'mesh-gradient': 'radial-gradient(circle at 20% 20%, rgba(80,141,255,0.18), transparent 28%), radial-gradient(circle at 80% 0%, rgba(124,58,237,0.16), transparent 32%), radial-gradient(circle at 10% 70%, rgba(14,165,233,0.18), transparent 30%), radial-gradient(circle at 90% 60%, rgba(16,185,129,0.12), transparent 36%)',
        'glass-panel': 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))'
      },
      backdropBlur: {
        xs: '6px',
        md: '12px'
      }
    }
  },
  plugins: [],
}
