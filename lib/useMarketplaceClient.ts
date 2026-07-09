"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClientSDK, type ApplicationContext } from "@sitecore-marketplace-sdk/client";

interface MarketplaceClientState {
  client: ClientSDK | null;
  appContext: ApplicationContext | null;
  error: Error | null;
  isEmbedded: boolean;
  isInitialized: boolean;
  isLoading: boolean;
}

let clientPromise: Promise<ClientSDK> | null = null;

function runningInIframe(): boolean {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

async function getMarketplaceClient(): Promise<ClientSDK> {
  if (!clientPromise) {
    const origin = new URLSearchParams(window.location.search).get("origin") ?? undefined;
    clientPromise = ClientSDK.init({
      target: window.parent,
      ...(origin ? { origin } : {}),
    });
  }

  return clientPromise;
}

export function useMarketplaceClient() {
  const initializedRef = useRef(false);
  const [state, setState] = useState<MarketplaceClientState>({
    client: null,
    appContext: null,
    error: null,
    isEmbedded: false,
    isInitialized: false,
    isLoading: false,
  });

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const isEmbedded = runningInIframe();
    if (!isEmbedded) {
      setState((current) => ({ ...current, isEmbedded }));
      return;
    }

    let cancelled = false;

    async function initialize() {
      setState((current) => ({ ...current, isEmbedded, isLoading: true, error: null }));

      try {
        const client = await getMarketplaceClient();
        const appContext = await client
          .query("application.context")
          .then((result) => result.data ?? null)
          .catch(() => null);

        if (!cancelled) {
          setState({
            client,
            appContext,
            error: null,
            isEmbedded,
            isInitialized: true,
            isLoading: false,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            client: null,
            appContext: null,
            error: error instanceof Error ? error : new Error("Marketplace SDK initialization failed"),
            isEmbedded,
            isInitialized: false,
            isLoading: false,
          });
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => state, [state]);
}
