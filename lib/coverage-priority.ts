export type CoverageInput = {
  entityType: "offer" | "message_thread" | "proposal";
  reasonTags: string[];
  referencedAt: Date;
  now?: Date;
};

export function scoreCoverage(input: CoverageInput): number {
  const now = input.now ?? new Date();
  let score = 0;

  switch (input.entityType) {
    case "offer":
      score += 100;
      break;
    case "message_thread":
      score +=
        input.reasonTags.includes("unread") || input.reasonTags.includes("needs_reply") ? 60 : 40;
      break;
    case "proposal":
      if (input.reasonTags.includes("offer_stage")) score += 80;
      else if (input.reasonTags.includes("interview_stage")) score += 50;
      else if (input.reasonTags.includes("viewed")) score += 20;
      else score += 10;
      break;
  }

  const ageDays = (now.getTime() - input.referencedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 7) score += 20;
  else if (ageDays <= 30) score += 5;

  return score;
}
