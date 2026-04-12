/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow extension sidebar to be embedded in iframe (Chrome side panel)
  async headers() {
    return [
      {
        source: '/sidebar',
        headers: [
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self' chrome-extension://*" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
