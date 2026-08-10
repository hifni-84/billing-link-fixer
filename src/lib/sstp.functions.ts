import { createServerFn } from "@tanstack/react-start";

export const sstpInfo = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { sstpServerInfo } = await import("./sstp.server");
    return await sstpServerInfo();
  } catch (e) {
    return {
      ready: false,
      network: "10.40.40.0/24",
      serverIp: "10.40.40.1",
      endpoint: "",
      port: 443,
      serviceUp: false,
      writable: false,
      error: e instanceof Error ? e.message : "SSTP tidak tersedia di server ini",
    };
  }
});

export const sstpPeers = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { sstpListPeers, sstpOnlineMap } = await import("./sstp.server");
    const [peers, online] = await Promise.all([sstpListPeers(), sstpOnlineMap()]);
    return {
      ok: true as const,
      error: null as string | null,
      peers: peers.map((p) => ({
        id: p.id,
        name: p.name,
        peerIp: p.peer_ip,
        username: p.username,
        online: online[p.peer_ip] ?? false,
      })),
    };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message, peers: [] };
  }
});

export const sstpAdd = createServerFn({ method: "POST" })
  .inputValidator((d: { name: string; secret?: string; registerNas?: boolean }) => d)
  .handler(async ({ data }) => {
    try {
      const { sstpAddPeer } = await import("./sstp.server");
      return await sstpAddPeer(data);
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

export const sstpScript = createServerFn({ method: "POST" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    try {
      const { sstpPeerScript } = await import("./sstp.server");
      return { ok: true as const, ...(await sstpPeerScript(data.id)) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

export const sstpRemove = createServerFn({ method: "POST" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    try {
      const { sstpDeletePeer } = await import("./sstp.server");
      return await sstpDeletePeer(data.id);
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

export const sstpTest = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      id: number;
      creds?: { username?: string; password?: string; port?: number; useHttps?: boolean };
    }) => d,
  )
  .handler(async ({ data }) => {
    try {
      const { sstpTestPeer } = await import("./sstp.server");
      return { ok: true as const, ...(await sstpTestPeer(data.id, data.creds)) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });
