/** @type {import('next').NextConfig} */
const nextConfig = {
  // The mongodb driver is a server-only dependency; keep it external to the server bundle.
  serverExternalPackages: ["mongodb"],
}

export default nextConfig
