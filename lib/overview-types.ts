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
  clientCompany: string | null;
  hiredAt: string | null;
  contractEndedAt: string | null;
  contractStatus: string | null;
  contractRating: number | null;
  contractBudget: string | null;
  contractRate: string | null;
  contractWeeklyLimit: string | null;
  createdAt: string;
  capturedBy: { id: string; name: string } | null;
  submittedBy: { id: string; name: string } | null;
  account?: { id: string; name: string };
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
  proposals: ProposalData[];
  proposalCount: number;
  alertCounts?: { messages: number; invites: number; offers: number };
  profile: FreelancerProfileData | null;
}

export interface FreelancerProfileData {
  title: string | null;
  photoUrl: string | null;
  location: string | null;
  hourlyRate: string | null;
  totalEarnings: string | null;
  totalJobs: number | null;
  totalHours: number | null;
  overview: string | null;
  skills: string[];
  capturedAt: string;
  updatedAt: string;
  capturedBy: { id: string; name: string } | null;
}

