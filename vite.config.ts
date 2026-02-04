import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/socket.io': {
          target: 'http://localhost:3001',
          ws: true,
        },
      },
    },
    plugins: [react()],
    define: {
      'process.env.AWS_ACCESS_KEY_ID': JSON.stringify(env.VITE_AWS_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID || ''),
      'process.env.AWS_SECRET_ACCESS_KEY': JSON.stringify(env.VITE_AWS_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY || ''),
      'process.env.AWS_REGION': JSON.stringify(env.VITE_AWS_REGION || env.AWS_REGION || 'us-east-1'),
      'process.env.AWS_NOVA_MODEL_ID': JSON.stringify(env.VITE_AWS_NOVA_MODEL_ID || env.AWS_NOVA_MODEL_ID || 'amazon.nova-2-sonic-v1:0')
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    test: {
      globals: true,
      environment: 'jsdom',
      exclude: ['node_modules', 'dist', '**/tests/e2e/**'],
      include: ['**/*.test.{ts,tsx}']
    }
  };
});
