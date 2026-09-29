import { extensionGone } from "@/lib/deprecated";

// Deprecated: extension ingestion removed (MCP migration, Phase C). Old code is in git history.
export async function POST() {
  return extensionGone();
}
