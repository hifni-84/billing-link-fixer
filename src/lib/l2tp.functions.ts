import { createServerFn } from "@tanstack/react-start";

export const l2tpInfo = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { l2tpServerInfo } = await import("./l2tp.server");
    return await l2tpServerInfo();
  } catch (e) {
    return {
      ready: false,
      network: "10.30.30.0/24",
      serverIp: "10.30.30.1",
      psk: null as string | null,
      endpoint: "",
      ipsecUp: false,
      l2tpUp: false,
      writable: false,
      error: e instanceof Error ? e.message : "L2TP tidak tersedia di server ini",
    };
  }
});

export const l2tpPeers = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { l2tpListPeers, l2tpOnlineMap } = await import("./l2tp.server");
    const [peers, online] = await Promise.all([l2tpListPeers(), l2tpOnlineMap()]);
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

export const l2tpAdd = createServerFn({ method: "POST" })
  .inputValidator((d: { name: string; secret?: string; registerNas?: boolean }) => d)
  .handler(async ({ data }) => {
    try {
      const { l2tpAddPeer } = await import("./l2tp.server");
      return await l2tpAddPeer(data);
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

export const l2tpScript = createServerFn({ method: "POST" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    try {
      const { l2tpPeerScript } = await import("./l2tp.server");
      return { ok: true as const, ...(await l2tpPeerScript(data.id)) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

export const l2tpRemove = createServerFn({ method: "POST" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    try {
      const { l2tpDeletePeer } = await import("./l2tp.server");
      return await l2tpDeletePeer(data.id);
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

export const l2tpTest = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      id: number;
      creds?: { username?: string; password?: string; port?: number; useHttps?: boolean };
    }) => d,
  )
  .handler(async ({ data }) => {
    try {
      const { l2tpTestPeer } = await import("./l2tp.server");
      return { ok: true as const, ...(await l2tpTestPeer(data.id, data.creds)) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });
