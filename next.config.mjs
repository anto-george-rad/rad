/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.STANDALONE === '1' ? 'standalone' : undefined,
  experimental: { serverActions: { bodySizeLimit: '8mb' }, instrumentationHook: true },
};
export default nextConfig;
