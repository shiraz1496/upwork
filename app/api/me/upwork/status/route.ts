import { requireDeveloper } from "@/lib/me-auth";
import { getConnection, publicStatus } from "@/lib/upwork/connection";
import { DISABLED_DETAIL, mcpEnabled, mockMode } from "@/lib/upwork/flags";
import { upworkRouteError } from "@/lib/upwork/http";

export async function GET() {
  try {
    const member = await requireDeveloper();
    const integration = mcpEnabled() ? "enabled" : mockMode() ? "mock" : "disabled";
    return Response.json({
      integration,
      ...(integration === "disabled" && { detail: DISABLED_DETAIL }),
      ...publicStatus(await getConnection(member.id)),
    });
  } catch (err) {
    return upworkRouteError(err);
  }
}
