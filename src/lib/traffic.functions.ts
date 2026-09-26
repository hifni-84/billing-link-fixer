import { createServerFn } from "@tanstack/react-start";

import type { TrafficSnapshot } from "./traffic-types";
import { TRAFFIC_APPS } from "./traffic-types";

export const trafficGet = createServerFn({ method: "GET" }).handler(
  async (): Promise<TrafficSnapshot> => {
    try {
      const { trafficSnapshot } = await import("./traffic.server");
      return await trafficSnapshot();
    } catch (e) {
      return {
        ok: false,
        error: (e as Error).message || "Gagal membaca data trafik",
        iface: null,
        url: "",
        totalBytes: 0,
        totalBps: 0,
        totalUsers: 0,
        apps: TRAFFIC_APPS.map((a) => ({
          ...a,
          bytes: 0,
          bps: 0,
          users: 0,
          flows: 0,
          clients: [],
        })),
        updatedAt: new Date().toISOString(),
      };
    }
  },
);
