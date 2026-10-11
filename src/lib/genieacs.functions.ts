import { createServerFn } from "@tanstack/react-start";

const fail = (e: unknown) => (e as Error).message || "Gagal menghubungi GenieACS";

export const acsDevicesGet = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { acsListDevices } = await import("./genieacs.server");
    return { ok: true as const, devices: await acsListDevices(), error: null };
  } catch (e) {
    return { ok: false as const, devices: [], error: fail(e) };
  }
});

export const acsDeviceGet = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    try {
      const { acsGetDevice } = await import("./genieacs.server");
      const { params: _p, ...device } = await acsGetDevice(data.id);
      return { ok: true as const, device, error: null };
    } catch (e) {
      return { ok: false as const, device: null, error: fail(e) };
    }
  });

export const acsParamsSet = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; writes: { path: string; value: string; type?: string }[] }) => d)
  .handler(async ({ data }) => {
    try {
      const { acsSetParams } = await import("./genieacs.server");
      await acsSetParams(data.id, data.writes);
      return { ok: true as const, error: null };
    } catch (e) {
      return { ok: false as const, error: fail(e) };
    }
  });

export const acsWanAdd = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { id: string; mode: "pppoe" | "bridge"; username?: string; password?: string; vlan?: string }) => d,
  )
  .handler(async ({ data }) => {
    try {
      const { acsAddWan } = await import("./genieacs.server");
      const { id, ...input } = data;
      const r = await acsAddWan(id, input);
      return { ok: true as const, vlanSet: r.vlanSet, error: null };
    } catch (e) {
      return { ok: false as const, vlanSet: false, error: fail(e) };
    }
  });

export const acsWanDelete = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; path: string }) => d)
  .handler(async ({ data }) => {
    try {
      const { acsDeleteObject } = await import("./genieacs.server");
      await acsDeleteObject(data.id, data.path);
      return { ok: true as const, error: null };
    } catch (e) {
      return { ok: false as const, error: fail(e) };
    }
  });

export const acsActionRun = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; action: "reboot" | "refresh" }) => d)
  .handler(async ({ data }) => {
    try {
      const { acsAction } = await import("./genieacs.server");
      await acsAction(data.id, data.action);
      return { ok: true as const, error: null };
    } catch (e) {
      return { ok: false as const, error: fail(e) };
    }
  });
