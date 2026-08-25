import { useEffect, useState } from "react";

export type AcsPanel = {
  /** URL web UI GenieACS (repo alijayanet), contoh: http://192.168.23.251:3001 */
  url: string;
  /** URL ACS yang diisi di ONT, contoh: http://192.168.23.5:7547 */
  cwmpUrl: string;
  /** URL NBI GenieACS (API), contoh: http://127.0.0.1:7557 */
  nbiUrl: string;
};

const KEY = "genieacs.panel";

export const emptyAcs: AcsPanel = { url: "", cwmpUrl: "", nbiUrl: "" };

function normalize(url: string) {
  const v = url.trim().replace(/\/+$/, "");
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `http://${v}`;
}

export function readAcs(): AcsPanel {
  if (typeof window === "undefined") return emptyAcs;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...emptyAcs, ...JSON.parse(raw) } : emptyAcs;
  } catch {
    return emptyAcs;
  }
}

export function writeAcs(panel: AcsPanel) {
  window.localStorage.setItem(
    KEY,
    JSON.stringify({
      url: normalize(panel.url),
      cwmpUrl: normalize(panel.cwmpUrl ?? ""),
      nbiUrl: normalize(panel.nbiUrl ?? ""),
    }),
  );
  window.dispatchEvent(new Event("genieacs-panel-changed"));
}

export function useAcs() {
  const [panel, setPanel] = useState<AcsPanel>(emptyAcs);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setPanel(readAcs());
    sync();
    setReady(true);
    window.addEventListener("genieacs-panel-changed", sync);
    return () => window.removeEventListener("genieacs-panel-changed", sync);
  }, []);

  return { panel, ready, configured: ready && panel.url.trim().length > 0 };
}
