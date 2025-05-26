const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

// Ensure dist/public directory exists
const distDir = path.join(__dirname, 'dist', 'public');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

esbuild.build({
  entryPoints: ['src/calendar-entry.tsx'],
  bundle: true,
  outfile: 'dist/public/calendar.js',
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  minify: process.env.NODE_ENV === 'production',
  sourcemap: process.env.NODE_ENV !== 'production',
  loader: {
    '.css': 'text',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    'global': 'window',
  },
  external: [],
  jsx: 'automatic',
  tsconfig: './tsconfig.json',
}).then(() => {
  console.log('Calendar bundle built successfully');
}).catch((error) => {
  console.error('Calendar build failed:', error);
  process.exit(1);
});