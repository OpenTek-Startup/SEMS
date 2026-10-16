import type { Metadata } from "next";
import PlatformConsole from "@/components/platform/PlatformConsole";

export const metadata: Metadata = {
  title: "Schools & modules · YESE",
};

export default function PlatformPage() {
  return <PlatformConsole />;
}
