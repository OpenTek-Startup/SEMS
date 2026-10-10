"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Provider } from "react-redux";
import { setupListeners } from "@reduxjs/toolkit/query";
import { makeStore } from "./store";

export default function StoreProvider({ children }: { children: ReactNode }) {
  // Lazy initial state: the store is created once per browser session.
  const [store] = useState(makeStore);

  // Refetch queries when the tab regains focus or the network comes back.
  useEffect(() => setupListeners(store.dispatch), [store]);

  return <Provider store={store}>{children}</Provider>;
}
