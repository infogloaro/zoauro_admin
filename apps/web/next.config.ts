import type { NextConfig } from 'next';

const config: NextConfig = {
  // a second dev server (the demo web on zoauro_demo) builds into its own folder; two servers sharing .next corrupt it
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  transpilePackages: ['@zoauro/shared'],
  async rewrites() {
    // Local dev only: in staging/prod Nginx routes /api/v1 to the API (doc 06 §2).
    const api = process.env.WEB_INTERNAL_API_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default config;
