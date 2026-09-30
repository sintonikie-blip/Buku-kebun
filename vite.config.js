import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: "autoUpdate",
    manifest: {
      name: "Buku Kebun", short_name: "Kebun", start_url: "/", scope: "/",
      display: "standalone", background_color: "#f6f5ef", theme_color: "#1f4d2b", lang: "id",
      icons: [
        { src: "icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }]
    }
  })]
});
