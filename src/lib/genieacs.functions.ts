import { createServerFn } from "@tanstack/react-start";

export const acsDevicesGet = createServerFn({ method: "GET" })
  .inputValidator((d: { nbiUrl: string }) => d)
  .handler(async ({ data }) => {
    try {
      const { acsListDevices } = await import("./genieacs.server");
      return { ok: true as const, devices: await acsListDevices(data.nbiUrl), error: null };
    } catch (e) {
      return { ok: false as const, devices: [], error: (e as Error).message };
    }
  });

export const acsDeviceGet = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string; nbiUrl: string }) => d)
  .handler(async ({ data }) => {
    try {
      const { acsGetDevice } = await import("./genieacs.server");
      return { ok: true as const, device: await acsGetDevice(data.id, data.nbiUrl), error: null };
    } catch (e) {
      return { ok: false as const, device: null, error: (e as Error).message };
    }
  });

export const acsParamsSet = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { id: string; writes: { path: string; value: string; type?: string }[]; nbiUrl: string }) =>
      d,
  )
  .handler(async ({ data }) => {
    try {
      const { acsSetParams } = await import("./genieacs.server");
      await acsSetParams(data.id, data.writes, data.nbiUrl);
      return { ok: true as const, error: null };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

export const acsObjectAdd = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; objectName: string; nbiUrl: string }) => d)
  .handler(async ({ data }) => {
    try {
      const { acsAddObject } = await import("./genieacs.server");
      await acsAddObject(data.id, data.objectName, data.nbiUrl);
      return { ok: true as const, error: null };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

export const acsObjectDelete = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; objectName: string; nbiUrl: string }) => d)
  .handler(async ({ data }) => {
    try {
      const { acsDeleteObject } = await import("./genieacs.server");
      await acsDeleteObject(data.id, data.objectName, data.nbiUrl);
      return { ok: true as const, error: null };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

export const acsActionRun = createServerFn({ method: "POST" })
  .inputValidator(
    (d: { id: string; action: "reboot" | "factoryReset" | "refresh"; nbiUrl: string }) => d,
  )
  .handler(async ({ data }) => {
    try {
      const { acsAction } = await import("./genieacs.server");
      await acsAction(data.id, data.action, data.nbiUrl);
      return { ok: true as const, error: null };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });
