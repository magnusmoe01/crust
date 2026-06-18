import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-firebase': [
            'firebase/app',
            'firebase/auth',
            'firebase/firestore',
            'firebase/functions',
            'firebase/storage',
            'firebase/analytics',
          ],
          'vendor-fa': [
            '@fortawesome/fontawesome-svg-core',
            '@fortawesome/free-solid-svg-icons',
            '@fortawesome/free-regular-svg-icons',
            '@fortawesome/react-fontawesome',
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api/financial-report': {
        target: 'https://europe-west1-crust-11575.cloudfunctions.net',
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/financial-report', '/financialReport'),
      },
    },
  },
})