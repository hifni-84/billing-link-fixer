import { createServerFn } from "@tanstack/react-start";

import { TEMPLATE_DEFAULT, type VoucherTemplate } from "./voucher-template";

const KEY = "voucher_templates";

function parse(raw: string | undefined): VoucherTemplate[] {
  if (!raw) return [TEMPLATE_DEFAULT];
  try {
    const list = JSON.parse(raw) as VoucherTemplate[];
    return Array.isArray(list) && list.length ? list : [TEMPLATE_DEFAULT];
  } catch {
    return [TEMPLATE_DEFAULT];
  }
}

/** Ambil daftar template voucher dari database (berlaku untuk semua perangkat). */
export const voucherTemplatesGet = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { getSettings } = await import("./radius.server");
    const s = await getSettings();
    return { ok: true as const, templates: parse(s[KEY]), error: null as string | null };
  } catch (e) {
    return { ok: false as const, templates: [TEMPLATE_DEFAULT], error: (e as Error).message };
  }
});

/** Simpan daftar template voucher ke database. */
export const voucherTemplatesSave = createServerFn({ method: "POST" })
  .inputValidator((d: { templates: VoucherTemplate[] }) => d)
  .handler(async ({ data }) => {
    try {
      const { saveSettings } = await import("./radius.server");
      await saveSettings({ [KEY]: JSON.stringify(data.templates ?? []) });
      return { ok: true as const, error: null as string | null };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });
