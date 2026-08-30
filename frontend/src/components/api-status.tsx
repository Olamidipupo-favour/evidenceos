"use client";

import { Wifi, WifiOff } from "lucide-react";

import type { ApiStatus } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export function ApiStatusPill({ status }: { status: ApiStatus }) {
  const online = status === "online";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[0.6875rem] font-medium",
        online
          ? "border-transparent bg-status-included-soft text-status-included"
          : status === "offline"
            ? "border-transparent bg-status-excluded-soft text-status-excluded"
            : "border-transparent bg-status-pending-soft text-status-pending",
      )}
      title={
        online
          ? "Backend API connected"
          : status === "offline"
            ? "Backend API offline"
            : "Checking backend API…"
      }
    >
      {online ? (
        <Wifi className="size-3" aria-hidden="true" />
      ) : (
        <WifiOff className="size-3" aria-hidden="true" />
      )}
      <span className="sr-only">API status</span>
      <span aria-hidden="true">
        {online ? "Connected" : status === "offline" ? "Offline" : "Connecting"}
      </span>
    </span>
  );
}
