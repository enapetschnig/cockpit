/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // googleapis (+ Transitiv-Deps wie node-domexception) nicht bundeln, sondern
  // zur Laufzeit per require laden – verhindert "Can't resolve 'worker_threads'".
  serverExternalPackages: ["googleapis"],
};

export default nextConfig;
