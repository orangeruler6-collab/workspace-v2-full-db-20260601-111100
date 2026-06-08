"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type HostActiveContextValue = {
  active: boolean;
  activePath: string;
  shouldLoadData: boolean;
};

type ActiveMessage = {
  type?: unknown;
  active?: unknown;
  path?: unknown;
};

const HostActiveContext = createContext<HostActiveContextValue>({
  active: true,
  activePath: "",
  shouldLoadData: true
});

export function HostActiveProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(true);
  const [activePath, setActivePath] = useState("");
  const [warmupData, setWarmupData] = useState(false);

  useEffect(() => {
    setActive(readInitialActiveState());
    setActivePath(readInitialActivePath());
    setWarmupData(readInitialWarmupDataState());

    function handleMessage(event: MessageEvent<ActiveMessage>) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "style-workbench-active-path") return;
      setActive(Boolean(event.data.active));
      if (typeof event.data.path === "string") setActivePath(event.data.path);
      setWarmupData(true);
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const shouldLoadData = active || warmupData || activePath === getCurrentPath();
  const value = useMemo(() => ({ active, activePath, shouldLoadData }), [active, activePath, shouldLoadData]);
  return <HostActiveContext.Provider value={value}>{children}</HostActiveContext.Provider>;
}

export function useHostActive() {
  return useContext(HostActiveContext);
}

function readInitialActiveState() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("hostActive") !== "0";
  } catch {
    return true;
  }
}

function readInitialWarmupDataState() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("hostWarmupData") === "1";
  } catch {
    return false;
  }
}

function readInitialActivePath() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("activePath") || "";
  } catch {
    return "";
  }
}

function getCurrentPath() {
  try {
    return window.location.pathname.replace(/^\/style-workbench/, "") || "/library";
  } catch {
    return "";
  }
}
