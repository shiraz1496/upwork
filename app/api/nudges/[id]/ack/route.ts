import { extensionGone } from "@/lib/deprecated";

// Deprecated: only the extension called this (MCP migration, Phase C). Old code is in git history.
export async function POST() {
  return extensionGone();
}
