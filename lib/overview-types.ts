export interface SnapshotSummary {
  id: string;
  capturedAt: string;
  startTimestamp: string | null;
  endTimestamp: string | null;
  range: string | null;
  jss: number | null;
  connectsBalance: number | null;
  sent: number;
  viewed: number;
  interviewed: number;
  hired: number;
  boostedSent: number;
  organicSent: number;
  boostedViewed: number;
  organicViewed: number;
  boostedInterviewed: number;
  organicInterviewed: number;
  boostedHired: number;
  organicHired: number;
  viewRate: number;
  interviewRate: number;
  hireRate: number;
  capturedBy: { id: string; name: string } | null;
}


export interface ProposalData {
  id: string;
  jobTitle: string | null;
  jobUrl: string | null;
  jobCategory: string | null;
  status: string | null;
  section: string | null;
  boosted: boolean;
  boostStatus: string | null;
  viewedByClient: boolean;
  coverLetter: string | null;
  clientNote: string | null;
  submittedViaExtension: boolean;
  clientName: string | null;
  clientCountry: string | null;
  connectsSpent: number | null;
  submittedAt: string | null;
  profileUsed: string | null;
  proposedRate: string | null;
  receivedRate: string | null;
  rateIncrease: string | null;
  bidConnects: number | null;
  jobBudget: string | null;
  jobHoursPerWeek: string | null;
  jobDuration: string | null;
  jobExperienceLevel: string | null;
  jobDescription: string | null;
  jobSkills: string[];
  jobPostedDate: string | null;
  clientRating: number | null;
  clientReviews: number | null;
  clientReviewScore: string | null;
  clientCity: string | null;
  clientJobsPosted: number | null;
  clientHireRate: number | null;
  clientOpenJobs: number | null;
  clientTotalSpent: string | null;
  clientHires: number | null;
  clientActiveHires: number | null;
  clientAvgRate: string | null;
  clientTotalHours: string | null;
  clientMemberSince: string | null;
  clientPaymentVerified: boolean;
  createdAt: string;
  capturedBy: { id: string; name: string } | null;
  submittedBy: { id: string; name: string } | null;
}

export interface AlertData {
  id: string;
  accountId: string;
  accountName: string;
  type: string;
  title: string;
  senderName: string | null;
  preview: string | null;
  url: string | null;
  roomId: string | null;
  jobTitle: string | null;
  date: string | null;
  freelancerReplied: boolean;
  lastMessageSender: string | null;
  lastMessageText: string | null;
  lastMessageTime: string | null;
  needsAttention: boolean;
  isUnread: boolean;
  read: boolean;
  replied: boolean;
  notifiedAt: string;
  remindedAt: string | null;
  createdAt: string;
  capturedBy: { id: string; name: string } | null;
}

export interface AccountData {
  id: string;
  freelancerId: string;
  name: string;
  jss: number | null;
  connectsBalance: number | null;
  isDisabled: boolean;
  disabledReason: string | null;
  createdAt: string;
  latestSnapshot: {
    capturedAt: string;
    startTimestamp: string | null;
    endTimestamp: string | null;
    jss: number | null;
    connectsBalance: number | null;
    funnel: { sent: number; viewed: number; interviewed: number; hired: number };
    boosted: { sent: number; viewed: number; interviewed: number; hired: number };
    organic: { sent: number; viewed: number; interviewed: number; hired: number };
    viewRate: number;
    interviewRate: number;
    hireRate: number;
  } | null;
  snapshots: SnapshotSummary[];
  snapshotCount: number;
  proposals: ProposalData[];
  proposalCount: number;
  alertCounts?: { messages: number; invites: number; offers: number };
}

export type OverviewRange = "7d" | "30d" | "90d";
