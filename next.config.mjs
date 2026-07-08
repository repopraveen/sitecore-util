/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Allow embedding inside the Sitecore Cloud Portal (Marketplace apps run in an iframe).
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://*.sitecorecloud.io https://*.sitecore.io https://portal.sitecorecloud.io",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
