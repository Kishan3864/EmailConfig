import type { MetadataRoute } from "next";

// Lets the phone "Add to Home Screen" open the app full screen, like a native app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Outreach",
    short_name: "Outreach",
    description: "Dheere aur safe cold mail",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f6f8",
    theme_color: "#f5f6f8",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
