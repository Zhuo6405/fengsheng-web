import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages 會把網站放在 /fengsheng-web/ 底下
export default defineConfig({
  base: '/fengsheng-web/',
  plugins: [react()],
})
