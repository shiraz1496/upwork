import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePrisma } from "./helpers/fake-prisma";

const fake = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-prisma").createFakePrisma> }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fake.db;
  },
}));

import { invalidateBlockedTitleCache } from "@/lib/blocked-titles";
import { factsFromJob, getReviewedJobs, logJobReview } from "@/lib/job-review";
import { completeAuth, startAuth } from "@/lib/upwork/connection";
import { MOCK_META, mockOAuthFetch, mockTransport } from "@/lib/upwork/mock";
import { normalizeJobs } from "@/lib/upwork/normalize";

const deps = () => ({ meta: MOCK_META, fetchImpl: mockOAuthFetch(), transport: mockTransport() });
const connect = async () => {
  const { authorizeUrl } = await startAuth("m1", deps());
  await completeAuth("m1", { code: "c", state: new URL(authorizeUrl).searchParams.get("state")! }, deps());
};

beforeEach(() => {
  fake.db = createFakePrisma();
  invalidateBlockedTitleCache();
  vi.stubEnv("UPWORK_MCP_ENABLED", "true");
  vi.stubEnv("UPWORK_MCP_MOCK", "");
  vi.stubEnv("UPWORK_OAUTH_CLIENT_ID", "client-abc");
  vi.stubEnv("UPWORK_OAUTH_REDIRECT_URI", "http://localhost:3000/api/me/upwork/callback");
});

describe("factsFromJob (from a live-shaped search row)", () => {
  const [job] = normalizeJobs({
    jobs: [
      {
        id: "1",
        title: "T",
        skills: ["Laravel", "PHP"],
        job_type: "hourly",
        proposals_tier: "10 to 15",
        client: { country: "GBR", rating: 4.73, total_spent: "$1,362.49", total_posted_jobs: 26, total_reviews: 18, verification_status: "NOT_VERIFIED" },
      },
    ],
  });

  it("maps what the search returns", () => {
    expect(factsFromJob(job, ["php"])).toMatchObject({
      clientTotalSpent: 1362.49,
      clientRating: 4.73,
      clientReviews: 18,
      clientJobsPosted: 26,
      clientPaymentVerified: false,
      clientCountry: "GBR",
      jobProposals: 15,
      skillMatchCount: 1,
    });
  });
  it("leaves everything the search does not return as null (unknown), never zero", () => {
    const f = factsFromJob(job);
    expect(f.clientHireRate).toBeNull();
    expect(f.clientActiveHires).toBeNull();
    expect(f.clientHires).toBeNull();
    expect(f.jobInterviewing).toBeNull();
    expect(f.jobHires).toBeNull();
    expect(f.jobLastViewedHours).toBeNull();
    expect(f.skillMatchCount).toBeNull(); // no profile skills given
  });
});

describe("getReviewedJobs", () => {
  it("flag off → disabled, no jobs", async () => {
    vi.stubEnv("UPWORK_MCP_ENABLED", "false");
    expect(await getReviewedJobs("m1", "search", {})).toEqual({ status: "disabled", provenance: null, data: null, jobs: null });
  });

  it("annotates each job with the matched reasons, keeps Upwork's order, adds no score", async () => {
    await connect();
    fake.db._criteria.push(
      { key: "client_total_spent", operator: "gte", value: "1000", required: true },
      { key: "client_payment_verified", operator: "eq", value: "true", required: true },
      { key: "client_country", operator: "neq", value: "India", required: true },
    );
    fake.db._accountConfig.set("acc1", { keywords: ["Laravel", "Shopify"], skills: ["Laravel", "MySQL", "Vue.js"] });

    const r = await getReviewedJobs("m1", "search", { title: "x" }, "acc1", deps());
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.provenance).toBe("MCP_VERIFIED");
    expect(r.jobs.map((j) => j.upworkJobId)).toEqual(["2100000000000000001", "2100000000000000002"]); // order kept

    const [a, b] = r.jobs;
    expect(a.evaluation.meetsRequired).toBe(true);
    expect(a.evaluation.matched).toEqual([
      "Client Total Spent ≥ $1,000",
      "Payment Verified",
      "Client Country ≠ India",
      "keyword: Laravel",
    ]);
    // Second mock job has no spend / verification info → unknown, not failed and not passed.
    expect(b.evaluation.meetsRequired).toBeNull();
    expect(b.evaluation.unknown).toEqual(["Client Total Spent ≥ $1,000", "Payment Verified"]);
    expect(b.evaluation.matched).toEqual(["Client Country ≠ India"]);
    expect(JSON.stringify(r.jobs)).not.toMatch(/score|rank/i);
  });

  it("an unknown accountId is an error, not a silently weaker review", async () => {
    await connect();
    await expect(getReviewedJobs("m1", "search", {}, "nope", deps())).rejects.toMatchObject({ code: "account_not_found" });
  });

  it("applies blocked titles", async () => {
    await connect();
    fake.db._blockedTitles.push("theme tweaks");
    const r = await getReviewedJobs("m1", "search", {}, null, deps());
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.jobs[0].evaluation.blockedBy).toBeNull();
    expect(r.jobs[1].evaluation).toMatchObject({ blockedBy: "theme tweaks", meetsRequired: false });
  });

  it("ignores inactive criteria", async () => {
    await connect();
    fake.db._criteria.push({ key: "client_rating", operator: "gte", value: "5", required: true, active: false });
    const r = await getReviewedJobs("m1", "search", {}, null, deps());
    if (r.status !== "ok") throw new Error("expected ok");
    expect(r.jobs[0].evaluation.results).toEqual([]);
  });
});

describe("logJobReview", () => {
  it("records one APP_RECORDED entry per member + job per day", async () => {
    expect(await logJobReview("m1", "job1", "Title")).toEqual({ logged: true });
    expect(await logJobReview("m1", "job1", "Title")).toEqual({ logged: false });
    expect(await logJobReview("m1", "job2")).toEqual({ logged: true });
    expect(await logJobReview("m2", "job1")).toEqual({ logged: true });
    expect(fake.db._reviewLogs).toHaveLength(3);
    expect(fake.db._reviewLogs[0]).toMatchObject({ memberId: "m1", upworkJobId: "job1", jobTitle: "Title", source: "APP_RECORDED" });
  });

  it("logs again once the previous entry is older than 24h", async () => {
    await logJobReview("m1", "job1");
    fake.db._reviewLogs[0].reviewedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(await logJobReview("m1", "job1")).toEqual({ logged: true });
  });
});
