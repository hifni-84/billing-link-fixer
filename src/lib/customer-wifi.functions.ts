import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const kredensial = z.object({
  username: z.string().trim().min(1, "Username wajib diisi").max(64),
  password: z.string().min(1, "Password wajib diisi").max(128),
});

const perubahan = kredensial.extend({
  indexes: z.array(z.string().max(4)).max(16).default([]),
  ssid: z.string().trim().max(32).default(""),
  wifiPassword: z.string().max(63).default(""),
});

export const wifiPortalInfo = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => kredensial.parse(d))
  .handler(async ({ data }) => {
    try {
      const { customerWifiInfo } = await import("./customer-wifi.server");
      return {
        ok: true as const,
        info: await customerWifiInfo(data.username, data.password),
        error: null,
      };
    } catch (e) {
      return { ok: false as const, info: null, error: (e as Error).message };
    }
  });

export const wifiPortalUpdate = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => perubahan.parse(d))
  .handler(async ({ data }) => {
    try {
      if (data.ssid && data.ssid.length < 3) {
        throw new Error("Nama WiFi minimal 3 karakter.");
      }
      if (data.wifiPassword && data.wifiPassword.length < 8) {
        throw new Error("Password WiFi minimal 8 karakter.");
      }
      const { customerWifiUpdate } = await import("./customer-wifi.server");
      const res = await customerWifiUpdate(data);
      return { ok: true as const, changed: res.changed, error: null };
    } catch (e) {
      return { ok: false as const, changed: [], error: (e as Error).message };
    }
  });
