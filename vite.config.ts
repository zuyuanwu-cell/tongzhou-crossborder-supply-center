import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");
          if (normalizedId.indexOf("node_modules/lucide-react") >= 0) return "icons";
          if (normalizedId.indexOf("node_modules/react") >= 0 || normalizedId.indexOf("node_modules/scheduler") >= 0) return "react-vendor";
          if (normalizedId.indexOf("/src/api.ts") >= 0) return "api-client";
          if (["/src/AfterSalesCenter.tsx", "/src/WarehouseCollaborationCenter.tsx", "/src/WarehouseTicketCenter.tsx"].some((name) => normalizedId.indexOf(name) >= 0)) return "warehouse-collaboration";
          if (normalizedId.indexOf("/src/MiaoshouListingWorkspace.tsx") >= 0) return "listing-workspace";
          if (normalizedId.indexOf("/src/TongzhouCanvasAiPanel.tsx") >= 0) return "tongzhou-ai";
          return undefined;
        },
      },
    },
  },
});
