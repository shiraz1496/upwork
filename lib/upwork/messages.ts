import { withMcp, type ConnectionDeps } from "@/lib/upwork/connection";
import { normalizeRooms, toolPayload, type RoomDto } from "@/lib/upwork/normalize";
import { disabledResult, isLive, ok, type ServiceResult } from "@/lib/upwork/result";

// get_messages action=list_rooms: the member's message rooms, most recently active first.
// Rooms carry no job id; link a room to a proposal with list_freelancer_proposals get_room
// (verified identifier), never by name/title similarity.
export async function listRooms(
  memberId: string,
  params: Record<string, unknown> = {},
  deps?: ConnectionDeps,
): Promise<ServiceResult<RoomDto[]>> {
  if (!isLive()) return disabledResult;
  return ok(
    await withMcp(
      memberId,
      async (c, orgUid) =>
        normalizeRooms(toolPayload(await c.callTool("get_messages", { action: "list_rooms", org_uid: orgUid, params }))),
      deps,
    ),
  );
}
