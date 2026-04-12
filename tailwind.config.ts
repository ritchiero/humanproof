import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        hp: {
          primary: '#1a1a2e',
          accent: '#e94560',
          surface: '#16213e',
          muted: '#0f3460',
          text: '#eaeaea',
        },
      },
    },
  },
  plugins: [],
};

export default config;
