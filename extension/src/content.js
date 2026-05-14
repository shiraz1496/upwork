console.log("[UT] Content script loaded:", window.location.href);

// ── Firefox fallback: inject into MAIN world via script tags ──
// Chrome uses chrome.scripting with world:"MAIN" from background.js
// Firefox doesn't support that, so we inject via script tags after a short delay
setTimeout(() => {
  if (!window.__utIntercepted) {
    console.log("[UT] MAIN world not injected by background, using script tag fallback");
    const s1 = document.createElement("script");
    s1.src = chrome.runtime.getURL("src/injected.js");
    s1.onload = () => s1.remove();
    (document.head || document.documentElement).appendChild(s1);

    const s2 = document.createElement("script");
    s2.src = chrome.runtime.getURL("src/account-detector.js");
    s2.onload = () => s2.remove();
    (document.head || document.documentElement).appendChild(s2);
  }
}, 1000);

// ── Listen for messages from MAIN world (injected.js) ──
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;

  if (event.data?.type === "UT_GQL_RESPONSE") {
    chrome.runtime.sendMessage(
      { type: "GQL_CAPTURED", payload: event.data.payload },
      (r) => { if (chrome.runtime.lastError) console.error("[UT]", chrome.runtime.lastError.message); }
    );
  }

  if (event.data?.type === "UPWORK_ACCOUNT_DETECTED") {
    console.log("[UT] Account detected via detector:", event.data.payload);
    chrome.runtime.sendMessage(
      { type: "SAVE_ACCOUNT_INFO", payload: event.data.payload },
      (r) => { if (chrome.runtime.lastError) console.error("[UT]", chrome.runtime.lastError.message); }
    );
  }

  if (event.data?.type === "UT_INITIAL_STATE") {
    try {
      const state = JSON.parse(event.data.payload);
      if (state && Object.keys(state).length > 0) {
        console.log("[UT] Got __INITIAL_STATE__");
        chrome.runtime.sendMessage({ type: "INITIAL_STATE", payload: { state, capturedAt: new Date().toISOString() } });
      }
    } catch (_) {}
  }
});

// ── Helpers ──
function extractNumber(text) {
  if (!text) return null;
  const cleaned = text.replace(/[,%$]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function sendToBackground(type, data) {
  console.log("[UT] Sending:", type, JSON.stringify(data).slice(0, 300));
  chrome.runtime.sendMessage({ type, payload: data }, (r) => {
    if (chrome.runtime.lastError) {
      console.error("[UT] Send error:", chrome.runtime.lastError.message);
    } else {
      console.log("[UT] Response:", JSON.stringify(r).slice(0, 200));
    }
  });
}

// ── Bad titles to always skip ──
const BAD_TITLES = [
  "open job in a new window", "open job", "my proposals", "my stats",
  "find work", "saved jobs", "send a proposal", "submit a proposal",
  "learn more", "upgrade", "contract-to-hire", "similar jobs",
  "apply now", "save job", "view profile", "sign in", "log in",
  "messages", "help", "settings", "view job posting", "view job",
  "proposal details", "job details", "insights",
  "search for jobs", "manage your profile", "browse jobs", "find a job",
  "post a job", "manage finances", "reports",
];

function isBadTitle(text) {
  const lower = text.toLowerCase().trim();
  if (lower.length < 5) return true;
  if (BAD_TITLES.some((bad) => lower === bad || lower.includes(bad))) return true;
  if (lower.startsWith("http")) return true;
  return false;
}

// ── Extract userId from various sources ──
// Only accept the freelancer ciphertext format (01 + ≥14 hex chars).
// Reject Upwork's short numeric internal IDs (e.g. "162" from cookies).
function extractUserId() {
  const isFreelancerId = (id) => /^~?01[a-f0-9]{14,}$/i.test(String(id || ""));
  const clean = (id) => String(id).replace(/^~/, "");

  // 1. Profile URL: /freelancers/~01f1419b6ce5c07b08
  const m1 = window.location.href.match(/\/freelancers\/~(\w+)/);
  if (m1 && isFreelancerId(m1[1])) return clean(m1[1]);

  // 2. Profile link anywhere in DOM (top-nav avatar dropdown, etc.)
  const link = document.querySelector('a[href*="/freelancers/~"]');
  if (link) {
    const m2 = link.href.match(/\/freelancers\/~(\w+)/);
    if (m2 && isFreelancerId(m2[1])) return clean(m2[1]);
  }

  // 3. Meta tag — only if ciphertext-shaped
  const meta = document.querySelector('meta[name="user-id"]');
  if (meta?.content && isFreelancerId(meta.content)) return clean(meta.content);

  // 4. Script tags — match the ciphertext specifically
  const scripts = document.querySelectorAll('script[type="application/json"], script:not([src])');
  for (const script of scripts) {
    const text = script.textContent;
    if (!text) continue;
    const m = text.match(/"(?:ciphertext|freelancerId)"\s*:\s*"~?(01[a-f0-9]{14,})"/i);
    if (m) return m[1];
  }

  // No cookie fallback — returns wrong-format internal IDs (e.g. "162")
  return null;
}

// ── SCRAPER: Account / Profile (ONLY runs on /freelancers/* pages) ──
function scrapeAccount() {
  console.log("[UT] Scraping profile page...");

  const info = { capturedAt: new Date().toISOString() };
  const bodyText = document.body.innerText;

  // ── userId from URL: /freelancers/~01f1419b6ce5c07b08 ──
  const profileMatch = window.location.href.match(/\/freelancers\/~(\w+)/);
  if (profileMatch) info.userId = profileMatch[1];

  // Also try meta tag and script data
  if (!info.userId) info.userId = extractUserId();

  // ── Name: first h1 or h2 that looks like a person's name ──
  const headings = document.querySelectorAll('h1, h2');
  for (const h of headings) {
    const text = h.textContent.trim();
    // Person name: 2-40 chars, starts uppercase, letters/dots/spaces only, no pipes
    if (text.length >= 2 && text.length <= 40 && /^[A-Z][a-zA-Z.\s'-]+$/.test(text)) {
      info.name = text;
      break;
    }
  }

  // ── Professional title: long h2 with pipe or comma ──
  for (const h of headings) {
    const t = h.textContent.trim();
    if (t.length > 15 && (t.includes('|') || t.includes(',')) && t !== info.name) {
      info.title = t;
      break;
    }
  }

  // ── Connects ──
  const connectsMatch = bodyText.match(/connects\s*:?\s*([\d,]+)/i);
  if (connectsMatch) info.connectsBalance = parseInt(connectsMatch[1].replace(/,/g, ""));

  // ── JSS ──
  const jssMatch = bodyText.match(/job\s*success\s*(?:score)?\s*:?\s*(\d+)\s*%?/i) ||
    bodyText.match(/(\d+)\s*%?\s*job\s*success/i);
  if (jssMatch) {
    const n = parseInt(jssMatch[1]);
    if (n > 0 && n <= 100) info.jss = n;
  }

  // ── Total earnings: "$30\nTotal earnings" ──
  const earningsMatch = bodyText.match(/\$([\d,.]+[KkMm+]*)\s*\n?\s*total\s*earnings/i);
  if (earningsMatch) info.totalEarnings = earningsMatch[1];

  // ── Total jobs: "1\nTotal jobs" ──
  const jobsMatch = bodyText.match(/(\d[\d,]*)\s*\n?\s*total\s*jobs/i);
  if (jobsMatch) info.totalJobs = parseInt(jobsMatch[1].replace(/,/g, ""));

  // ── Total hours: "1\nTotal hours" ──
  const hoursMatch = bodyText.match(/([\d,]+)\s*\n?\s*total\s*hours/i);
  if (hoursMatch) info.totalHours = parseInt(hoursMatch[1].replace(/,/g, ""));

  // ── Hourly rate: "$15.00/hr" ──
  const rateMatch = bodyText.match(/\$([\d,.]+)\s*\/\s*hr/i);
  if (rateMatch) info.hourlyRate = rateMatch[1];

  // ── Location: "Islamabad, Pakistan – 3:15 pm local time" ──
  const locMatch = bodyText.match(/([\w\s]+,\s*[\w\s]+)\s*[-–]\s*\d+:\d+\s*(?:am|pm)/i);
  if (locMatch) info.location = locMatch[1].trim();

  // ── Availability ──
  if (/available\s*now/i.test(bodyText)) info.availableNow = true;

  console.log("[UT] Profile scraped:", JSON.stringify(info).slice(0, 400));

  // ALWAYS send to background if we have anything useful
  if (info.userId || info.name || info.connectsBalance || info.jss) {
    sendToBackground("SCRAPED_ACCOUNT", info);
  } else {
    console.log("[UT] No account data found");
  }
}

// ── SCRAPER: Stats Page ──
function scrapeStats() {
  console.log("[UT] Scraping stats page...");

  const stats = { capturedAt: new Date().toISOString(), metrics: {} };
  const bodyText = document.body.innerText;

  // Detect which Upwork date-range filter is active on the Proposals card.
  // Dropdown options are kept in the DOM even when the dropdown is closed —
  // we must exclude those (they're hidden) and only match the visible trigger.
  // Also when walking up we must not cross into an ancestor that encompasses
  // both the Proposals card and the Profile Metrics card (which also has a
  // "Last N days" dropdown).
  (() => {
    const labels = Array.from(document.querySelectorAll("button, span, div, [role='button']"))
      .filter((el) => {
        if (!/^Last\s+(7|30|90)\s+days$/i.test((el.textContent || "").trim())) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    for (const label of labels) {
      let parent = label.parentElement;
      for (let i = 0; i < 10 && parent; i++) {
        const txt = parent.innerText || "";
        if (/profile\s+metrics/i.test(txt)) break;
        if (/\d+\s+proposals?\s+sent/i.test(txt)) {
          const m = label.textContent.trim().match(/^Last\s+(7|30|90)\s+days$/i);
          if (m) {
            stats.range = m[1] === "7" ? "7d" : m[1] === "30" ? "30d" : "90d";
            return;
          }
        }
        parent = parent.parentElement;
      }
    }
  })();

  const metricPatterns = {
    proposals_sent: [/(\d+)\s*proposals?\s*sent/i, /sent\s*:?\s*(\d+)/i],
    proposals_viewed: [/(\d+)\s*(?:proposals?\s*)?(?:were\s*)?viewed/i, /(\d+)\s*were\s*viewed/i, /viewed\s*:?\s*(\d+)/i],
    proposals_interviewed: [/(\d+)\s*interview(?:s|ed)?/i, /interview(?:ed|s)?\s*:?\s*(\d+)/i],
    proposals_hired: [/(\d+)\s*hire[ds]?/i, /hire[ds]?\s*:?\s*(\d+)/i],
  };

  for (const [key, patterns] of Object.entries(metricPatterns)) {
    for (const regex of patterns) {
      const match = bodyText.match(regex);
      if (match) {
        stats.metrics[key] = parseInt(match[1]);
        break;
      }
    }
  }

  const connectsMatch = bodyText.match(/connects\s*:?\s*([\d,]+)/i);
  if (connectsMatch) stats.connectsBalance = parseInt(connectsMatch[1].replace(/,/g, ""));

  const jssMatch = bodyText.match(/job\s*success\s*(?:score)?\s*:?\s*(\d+)/i);
  if (jssMatch) stats.jss = parseInt(jssMatch[1]);

  stats.rawText = bodyText.slice(0, 3000);

  if (Object.keys(stats.metrics).length > 0 || stats.jss || stats.connectsBalance) {
    sendToBackground("SCRAPED_STATS", stats);
  } else {
    sendToBackground("SCRAPED_STATS_RAW", { rawText: stats.rawText, capturedAt: stats.capturedAt });
  }
}

// ── Scroll entire page/panel to trigger lazy-loaded content ──
async function scrollToLoadAll() {
  // Find the scrollable container — could be the page or a side panel
  const panel = document.querySelector('[class*="drawer"], [class*="panel"], [class*="slider"], [class*="detail"], [role="dialog"]');
  const scrollTarget = panel || document.documentElement;

  const scrollHeight = scrollTarget.scrollHeight;
  const step = 500;
  for (let pos = 0; pos < scrollHeight; pos += step) {
    scrollTarget.scrollTop = pos;
    await new Promise((r) => setTimeout(r, 150));
  }
  // Scroll back to top
  scrollTarget.scrollTop = 0;
  // Wait for any lazy content to finish rendering
  await new Promise((r) => setTimeout(r, 1000));
}

// ── Find the job detail container (full page OR side panel) ──
function findJobContainer() {
  // The slider panel — Upwork uses a modal/slider for job details from the feed
  // Try multiple selectors from most specific to least
  const selectors = [
    // Upwork's slider panel (URL contains navType=slider)
    '[class*="slider"] [class*="content"]',
    '[class*="slider"]',
    '[class*="air3-slider"]',
    // Modal / drawer patterns
    '[class*="drawer"]',
    '[class*="modal-content"]',
    '[role="dialog"]',
    // Job detail specific
    '[class*="job-details"]',
    '[class*="detail-panel"]',
  ];

  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      // Must have substantial content and contain job-like text
      if (el.innerText.length > 200 && (
        el.innerText.includes("Send a proposal") ||
        el.innerText.includes("Apply now") ||
        el.innerText.includes("Open job in a new window") ||
        el.innerText.includes("Summary")
      )) {
        console.log("[UT] Found job container via:", sel);
        return el;
      }
    }
  }

  // Fallback: find the element containing "Open job in a new window" and go up
  const openJobLink = Array.from(document.querySelectorAll("a")).find(
    (a) => /open\s*job\s*in\s*a\s*new\s*window/i.test(a.textContent)
  );
  if (openJobLink) {
    // Walk up to find a large container
    let parent = openJobLink.parentElement;
    while (parent && parent !== document.body) {
      if (parent.innerText.length > 500 && parent.offsetWidth > 300) {
        console.log("[UT] Found job container via Open Job link parent");
        return parent;
      }
      parent = parent.parentElement;
    }
  }

  // Full job page — use main content area
  const main = document.querySelector('main, [role="main"]');
  if (main) return main;

  return document.body;
}

// ── Extract job URL from the container or page ──
function findJobUrl(container) {
  // From the "Open job in a new window" link
  const openLink = container.querySelector('a[href*="/jobs/~"]');
  if (openLink) return openLink.href.split("?")[0];

  // From page URL
  const urlMatch = window.location.href.match(/(https:\/\/www\.upwork\.com\/jobs\/~\w+)/);
  if (urlMatch) return urlMatch[1];

  // From any canonical/og link
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical?.href?.includes("/jobs/")) return canonical.href;

  return window.location.href;
}

// ── SCRAPER: Job Post (full page OR side panel) ──
async function scrapeJob() {
  console.log("[UT] Scraping job post...");

  // Scroll to load all lazy content
  await scrollToLoadAll();

  const container = findJobContainer();
  const text = container.innerText;
  const job = { capturedAt: new Date().toISOString() };

  // ── URL ──
  job.url = findJobUrl(container);
  console.log({container,text})

  // ── Title: find the actual job title, skip all non-title text ──
  const sectionHeadings = ["summary", "skills", "activity on this job", "about the client",
    "experience level", "project type", "questions", "proposals", "featured jobs"];
  const headings = container.querySelectorAll('h1, h2, h3, h4');
  for (const h of headings) {
    const t = h.textContent.trim();
    if (t.length < 5 || t.length > 200) continue;
    const lower = t.toLowerCase();
    // Skip bad titles (Open job, My Proposals, etc.)
    if (isBadTitle(t)) continue;
    // Skip section headings
    if (sectionHeadings.some((s) => lower === s)) continue;
    // Skip generic UI text
    if (/^(contract|featured|upgrade|boost|promoted)/i.test(lower)) continue;
    // This should be the actual job title
    job.title = t;
    break;
  }

  // ── Budget ──
  const budgetMatch = text.match(/\$([\d,.]+)\s*\n?\s*(?:Fixed-price|fixed.price)/i);
  if (budgetMatch) {
    job.budget = "$" + budgetMatch[1];
    job.jobType = "fixed";
  }
  if (!job.budget) {
    const hourlyMatch = text.match(/\$([\d,.]+)\s*[-–]\s*\$([\d,.]+)\s*(?:\/\s*hr|hourly)/i);
    if (hourlyMatch) {
      job.budget = `$${hourlyMatch[1]} - $${hourlyMatch[2]}/hr`;
      job.jobType = "hourly";
    }
  }
  // Standalone price
  if (!job.budget) {
    const priceMatch = text.match(/\$([\d,]+(?:\.\d+)?)\s*\n/);
    if (priceMatch) job.budget = "$" + priceMatch[1];
  }

  // ── Job type (if not already set) ──
  if (!job.jobType) {
    if (/fixed.price/i.test(text)) job.jobType = "fixed";
    else if (/hourly/i.test(text)) job.jobType = "hourly";
  }

  // ── Experience level ──
  const expMatch = text.match(/(entry[\s-]?level|intermediate|expert)\s*[\n\s]*experience\s*level/i) ||
    text.match(/experience\s*level\s*[\n\s]*(entry[\s-]?level|intermediate|expert)/i) ||
    text.match(/\b(entry[\s-]?level|intermediate|expert)\b/i);
  if (expMatch) job.experienceLevel = expMatch[1];

  // ── Connects required: "Send a proposal for: 14 Connects" ──
  const connectsMatch = text.match(/(?:send\s*a\s*proposal\s*for|submit.*?for)\s*:?\s*(\d+)\s*connects/i) ||
    text.match(/(\d+)\s*connects?\s*(?:required|to\s*submit|needed)/i);
  if (connectsMatch) job.connectsRequired = parseInt(connectsMatch[1]);

  // ── Available connects ──
  const availConnects = text.match(/available\s*connects?\s*:?\s*([\d,]+)/i);
  if (availConnects) job.availableConnects = parseInt(availConnects[1].replace(/,/g, ""));

  // ── Posted time ──
  const postedMatch = text.match(/posted\s+(.+?)(?:\n|$)/i);
  if (postedMatch) job.postedTime = postedMatch[1].trim();

  // ── Job location (Worldwide, US only, etc.) — this is WHERE the job is, not the client ──
  const jobLocMatch = text.match(/(?:posted.*?\n.*?)\b(worldwide|united states only|us only)\b/i);
  if (jobLocMatch) job.jobLocation = jobLocMatch[1].trim();

  // ── Summary / Description (get FULL text, not just 500 chars) ──
  // Look for "Summary" section
  const summaryMatch = text.match(/summary\s*\n([\s\S]*?)(?=\n\s*\$[\d]|\n\s*skills|\n\s*activity|\n\s*about the client|\n\s*contract-to-hire|$)/i);
  if (summaryMatch) {
    job.description = summaryMatch[1].trim().slice(0, 2000);
  }
  // Fallback: description element
  if (!job.description) {
    const descEl = container.querySelector('[data-test="description"], [class*="description"], [class*="job-description"]');
    if (descEl) job.description = descEl.textContent.trim().slice(0, 2000);
  }

  // ── Skills ──
  const skillEls = container.querySelectorAll('.air3-badge, [class*="skill-badge"], [data-test="skill"], .up-skill-badge, [class*="air3-token"]');
  if (skillEls.length > 0) {
    job.skills = Array.from(skillEls)
      .map((el) => el.textContent.trim())
      .filter((s) => s.length > 0 && s.length < 50)
      .slice(0, 30);
  }

  // ── Project type: "Project Type: Ongoing project" ──
  const projMatch = text.match(/project\s*type\s*:?\s*(.+?)(?:\n|$)/i);
  if (projMatch) job.projectType = projMatch[1].trim();

  // ── Contract-to-hire ──
  if (/contract.to.hire/i.test(text)) job.contractToHire = true;

  // ── Client info — parse the "About the client" block as a whole ──
  const aboutMatch = text.match(/about\s*the\s*client([\s\S]*?)(?=\n\s*job\s*link|\n\s*similar\s*jobs|\n\s*how\s*it\s*works|\n\s*activity\s*on\s*this\s*job|$)/i);
  if (aboutMatch) {
    const block = aboutMatch[1];
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

    // Payment & phone verified
    job.clientPaymentVerified = /payment\s*method\s*verified/i.test(block);
    job.clientPhoneVerified = /phone\s*number\s*verified/i.test(block);

    // Rating — standalone float like "5.0" (the big star rating)
    const ratingLine = lines.find((l) => /^\d+\.\d+$/.test(l));
    if (ratingLine) job.clientRating = parseFloat(ratingLine);

    // Review score — "5.00 of 4 reviews"
    const reviewMatch = block.match(/([\d.]+)\s*of\s*(\d+)\s*reviews?/i);
    if (reviewMatch) {
      job.clientReviewScore = reviewMatch[0].trim();
      job.clientReviews = parseInt(reviewMatch[2]);
      if (!job.clientRating) job.clientRating = parseFloat(reviewMatch[1]);
    }

    // Country & City — look for a short uppercase code (e.g. "FRA") or country name,
    // followed by a city + time line like "Paris  1:38 PM"
    const countryIdx = lines.findIndex((l) =>
      /^[A-Z]{2,4}$/.test(l) || // ISO-like codes: US, FRA, DEU, etc.
      /^(United States|United Kingdom|Canada|Australia|India|Pakistan|Germany|France|Thailand|Philippines|Singapore|Netherlands|Israel|Brazil|Japan|China|South Korea|Spain|Italy|Sweden|Norway|Denmark|Switzerland|Ireland|New Zealand|Mexico|Argentina|Colombia|Chile|Egypt|Nigeria|Kenya|South Africa|UAE|Saudi Arabia|Bangladesh|Sri Lanka|Vietnam|Indonesia|Malaysia|Turkey|Poland|Ukraine|Romania|Czech Republic|Hungary|Portugal|Greece|Belgium|Austria|Finland|Russia|Belarus|Georgia|Armenia|Azerbaijan|Jordan|Lebanon|Qatar|Bahrain|Kuwait|Oman)$/i.test(l)
    );
    if (countryIdx !== -1) {
      job.clientCountry = lines[countryIdx];
      // Next line is typically "City  TIME" — extract city before double-space or time pattern
      const nextLine = lines[countryIdx + 1];
      if (nextLine) {
        const cityMatch = nextLine.match(/^(.+?)\s{2,}/) || nextLine.match(/^(.+?)\s+\d{1,2}:\d{2}\s*(AM|PM|am|pm)/);
        if (cityMatch) job.clientCity = cityMatch[1].trim();
      }
    }

    // Total spent — "$1.4K total spent" or "$10K+ spent"
    const spentMatch = block.match(/\$([\d,.]+[KkMm]*\+?)\s*(?:total\s*)?spent/i);
    if (spentMatch) job.clientSpent = "$" + spentMatch[1];

    // Jobs posted — "4 jobs posted"
    const jobsPostedMatch = block.match(/(\d+)\s*jobs?\s*posted/i);
    if (jobsPostedMatch) job.clientJobsPosted = parseInt(jobsPostedMatch[1]);

    // Hire rate & open jobs — "100% hire rate, 2 open jobs"
    const hireRateMatch = block.match(/(\d+)%\s*hire\s*rate/i);
    if (hireRateMatch) job.clientHireRate = parseInt(hireRateMatch[1]);
    const openJobsMatch = block.match(/(\d+)\s*open\s*jobs?/i);
    if (openJobsMatch) job.clientOpenJobs = parseInt(openJobsMatch[1]);

    // Hires & active — "5 hires, 1 active"
    const hiresMatch = block.match(/(\d+)\s*hires?\s*,?\s*(\d+)\s*active/i);
    if (hiresMatch) {
      job.clientHires = parseInt(hiresMatch[1]);
      job.clientActiveHires = parseInt(hiresMatch[2]);
    }

    // Industry — e.g. "Tech & IT", "Sales & Marketing" — a line with "&" that isn't money
    const industryLine = lines.find((l) => /&/.test(l) && !/\$/.test(l) && l.length < 40 && !/hire|job|member|spent|verified/i.test(l));
    if (industryLine) job.clientIndustry = industryLine;

    // Company size — "Small company (2-9 people)" or "Mid-sized company (10-99 people)"
    const companySizeMatch = block.match(/((?:small|mid[- ]?sized|large)\s*company\s*\([^)]+\))/i);
    if (companySizeMatch) job.clientCompanySize = companySizeMatch[1].trim();

    // Member since — "Member since Aug 23, 2025"
    const memberMatch = block.match(/member\s*since\s*(.+?)(?:\n|$)/i);
    if (memberMatch) job.clientMemberSince = memberMatch[1].trim();
  }

  console.log("[UT] Job scraped:", JSON.stringify(job).slice(0, 500));

  if (job.title) {
    sendToBackground("SCRAPED_JOB", job);
  } else {
    console.log("[UT] No job title found");
  }
}

// ── SCRAPER: Proposals List (with pagination) ──
async function scrapeProposals() {
  console.log("[UT] Scraping proposals page...");

  const allProposals = [];
  let pageNum = 1;
  const maxPages = 20;

  while (pageNum <= maxPages) {
    console.log("[UT] Scraping proposals page", pageNum);
    await scrollToLoadAll();

    const bodyText = document.body.innerText;
    const proposals = [];
    const usedLinks = new Set();

    const lines = bodyText.split("\n").map((l) => l.trim()).filter(Boolean);
    let currentSection = "Unknown";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const sectionMatch = line.match(/^(Offers?|Invites?\s*from\s*clients?|Active\s*proposals?|Submitted\s*proposals?|Archived\s*proposals?|Archived\s*interviews?)\s*\(\d+\)/i);
      if (sectionMatch) {
        const raw = sectionMatch[1].trim().toLowerCase().replace(/\s+/g, " ");
        const canonicalMap = {
          "offers": "Offers",
          "offer": "Offers",
          "invites from clients": "Invites from clients",
          "invite from client": "Invites from clients",
          "invites from client": "Invites from clients",
          "active proposals": "Active proposals",
          "active proposal": "Active proposals",
          "submitted proposals": "Submitted proposals",
          "submitted proposal": "Submitted proposals",
          "archived proposals": "Archived proposals",
          "archived proposal": "Archived proposals",
          "archived interviews": "Archived interviews",
          "archived interview": "Archived interviews",
        };
        currentSection = canonicalMap[raw] || sectionMatch[1].trim();
        continue;
      }

      const dateMatch = line.match(/^(?:Initiated|Received)\s+(.+)/i);
      if (dateMatch) {
        const proposal = {
          section: currentSection,
          submittedAt: dateMatch[1].trim(),
          boosted: false,
        };

        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const next = lines[j];

          if (/^Boosted$/i.test(next)) {
            proposal.boosted = true;
            proposal.boostStatus = "Boosted";
          } else if (/^Boost\s*outbid$/i.test(next)) {
            proposal.boosted = true;
            proposal.boostStatus = "Boost outbid";
          }

          if (/^[A-Za-z][A-Za-z ]*\sProfile$/.test(next) && next.length < 40) {
            proposal.profileUsed = next;
          }

          if (/^\d+\s*(second?|seconds?|minute?|minutes?|hour?|hours?|day?|days?|week?|weeks?|month?|months?|quarter?|quarters?)\s*ago$|^yesterday$|^last\s*(week|month|quarter)$/i.test(next)) {
            proposal.relativeTime = next;
          }

          if (/viewed\s*by\s*client/i.test(next)) {
            proposal.viewedByClient = true;
          }

          if (/^(job is closed|declined by you|declined by client|hired|offered|interviewed)$/i.test(next)) {
            proposal.status = next;
          }
        }

        const allLinks = document.querySelectorAll('a[href*="/jobs/"], a[href*="/proposals/"]');
        for (const link of allLinks) {
          if (usedLinks.has(link)) continue;
          const linkText = link.textContent.trim();
          if (linkText.length < 5 || isBadTitle(linkText)) continue;
          const row = link.closest("tr, [class*='row'], [class*='card'], [class*='tile'], section, li, div[class]");
          if (row && (row.innerText.includes(dateMatch[0]) || row.innerText.includes(dateMatch[1]))) {
            proposal.title = linkText;
            // Extract proper Upwork job URL from whatever link format
            const href = link.href;
            const jobIdMatch = href.match(/~(\w{15,})/);
            if (jobIdMatch) {
              proposal.url = "https://www.upwork.com/jobs/~" + jobIdMatch[1];
            } else {
              proposal.url = href.split("?")[0];
            }
            usedLinks.add(link);
            break;
          }
        }

        if (!proposal.title) {
          for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
            const next = lines[j];
            if (next.length > 10 && !isBadTitle(next) &&
              !/^Initiated|^Received|^Boosted|^Boost\s|profile$/i.test(next) &&
              !/^\d+\s*(second?|seconds?|minute?|minutes?|hour?|hours?|day?|days?|week?|weeks?|month?|months?|quarter?|quarters?)\s*ago/i.test(next) &&
              !/^yesterday$|^last\s/i.test(next)) {
              proposal.title = next;
              break;
            }
          }
        }

        if (proposal.title) {
          proposals.push(proposal);
        }
      }
    }

    // Fallback for this page: try DOM links
    if (proposals.length === 0) {
      // Only accept links pointing at a real Upwork job posting (~01…);
      // this keeps nav/footer links like "Search for jobs" out of the DB.
      const links = document.querySelectorAll('a[href*="/jobs/~"], a[href*="/proposals/job/~"]');
      const seen = new Set();
      for (const link of links) {
        const text = link.textContent.trim();
        const href = link.href.split("?")[0];
        const jobIdMatch = href.match(/~(\w{15,})/);
        if (jobIdMatch && text.length > 5 && !seen.has(href) && !isBadTitle(text)) {
          seen.add(href);
          const canonicalUrl = "https://www.upwork.com/jobs/~" + jobIdMatch[1];
          proposals.push({ title: text, url: canonicalUrl, section: "Unknown", boosted: false });
        }
      }
    }

    allProposals.push(...proposals);
    console.log("[UT] Page", pageNum, "found", proposals.length, "proposals. Total:", allProposals.length);

    // Scope pagination search to an actual pagination container so we don't
    // accidentally click chevrons/arrows on proposal rows (which navigate to
    // a random proposal — especially on the Archive tab, which usually has
    // no multi-page pagination at all).
    const searchRoot = document.querySelector(
      'nav[aria-label*="pagination" i], [role="navigation"][aria-label*="pagination" i], [class*="pagination" i], [data-test*="pagination" i]'
    );

    const isRowLink = (el) => {
      if (el.tagName !== "A") return false;
      const href = el.getAttribute("href") || "";
      return /\/(jobs|proposals)\//.test(href);
    };

    let nextBtn = null;
    if (searchRoot) {
      nextBtn = Array.from(searchRoot.querySelectorAll('button, a, [role="button"]')).find((el) => {
        if (isRowLink(el)) return false;
        const text = el.textContent.trim();
        const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
        if (ariaLabel.includes("next")) return true;
        if (text === "›" || text === ">" || text === "→" || text === "»" || text === "Next") return true;
        if (text === String(pageNum + 1)) return true;
        return false;
      });

      // Fallback: SVG arrow button inside pagination container only
      if (!nextBtn) {
        const allBtns = searchRoot.querySelectorAll('button, a, [role="button"]');
        for (const btn of allBtns) {
          if (isRowLink(btn)) continue;
          const svg = btn.querySelector("svg");
          if (svg && btn.getBoundingClientRect().x > 0) {
            const prevSibling = btn.previousElementSibling;
            if (prevSibling && /^\d+$/.test(prevSibling.textContent.trim())) {
              const lastPageNum = parseInt(prevSibling.textContent.trim());
              if (lastPageNum > pageNum) {
                nextBtn = btn;
                break;
              }
            }
          }
        }
      }
    }

    if (nextBtn && !nextBtn.disabled && !nextBtn.getAttribute("aria-disabled")) {
      nextBtn.click();
      pageNum++;
      // Wait for new page content to load
      await new Promise((r) => setTimeout(r, 2500));
    } else {
      break;
    }
  }

  console.log("[UT] Scraped", allProposals.length, "total proposals across", pageNum, "pages");
  if (allProposals.length > 0) {
    sendToBackground("SCRAPED_PROPOSALS", { proposals: allProposals, capturedAt: new Date().toISOString() });
  }
}

// ── SCRAPER: Proposal Detail Page (/nx/proposals/NUMBERS) ──
async function scrapeProposalDetail() {
  console.log("[UT] Scraping proposal detail page...");
  await scrollToLoadAll();

  // Click all "more" links to expand truncated descriptions
  const moreLinks = document.querySelectorAll("a, button, span");
  for (const el of moreLinks) {
    const t = el.textContent.trim().toLowerCase();
    if (t === "more" || t === "... more" || t === "…more") {
      try { el.click(); } catch (_) {}
    }
  }
  // Wait for expanded content to render
  await new Promise((r) => setTimeout(r, 1500));

  const text = document.body.innerText;
  const proposal = { capturedAt: new Date().toISOString() };

  // Get the proposal URL as identifier
  proposal.detailUrl = window.location.href;
  const isInterview = /\/proposals\/interview\/uid\//.test(proposal.detailUrl);

  if (isInterview) {
    proposal.section = "Archived interviews";
    const heading = (document.querySelector("h1, h2")?.textContent || "").trim().toLowerCase();
    if (/declined\s+invitation/.test(heading)) proposal.status = "Declined by You";
    else if (/accepted\s+invitation/.test(heading)) proposal.status = "Accepted";
  }

  // ── Job URL from links ──
  const jobLinks = document.querySelectorAll('a[href*="/jobs/~"]');

  // First: get the canonical job URL from "View job posting" link
  for (const link of jobLinks) {
    if (/view\s*job/i.test(link.textContent.trim())) {
      proposal.url = link.href.split("?")[0];
      break;
    }
  }

  // Second: find a good title from non-"View job" links
  for (const link of jobLinks) {
    const linkText = link.textContent.trim();
    if (isBadTitle(linkText) || /^view\s*job/i.test(linkText)) continue;
    if (linkText.length > 5) {
      proposal.title = linkText;
      if (!proposal.url) proposal.url = link.href.split("?")[0];
      break;
    }
  }

  // Fallback: look for title under "Job details" section
  if (!proposal.title) {
    const jobDetailsMatch = text.match(/job\s*details\s*\n\s*(.+?)(?:\n|$)/i);
    if (jobDetailsMatch) {
      const t = jobDetailsMatch[1].trim();
      if (t.length > 3 && !isBadTitle(t)) {
        proposal.title = t;
      }
    }
  }

  // Fallback: find title from page heading, skip known non-title headings
  if (!proposal.title) {
    const skipHeadings = /^cover\s*letter$|^messages$|^client$|^about\s*the\s*client$|^view\s*job|^proposal\s*details$|^job\s*details$|^insights$|^average|^top\s*profile|^upgrade|^your\s*proposed|^boosted|^skills/i;
    const headings = document.querySelectorAll("h1, h2, h3");
    for (const h of headings) {
      const t = h.textContent.trim();
      if (t.length > 3 && !isBadTitle(t) && !skipHeadings.test(t)) {
        proposal.title = t;
        break;
      }
    }
  }

  // ── Job Category — try badge elements first (grey tag under title) ──
  const catBadges = document.querySelectorAll('.air3-badge, [class*="badge"], [class*="tag"], [class*="token"], [class*="chip"]');
  for (const badge of catBadges) {
    const t = badge.textContent.trim();
    if (t.length > 3 && t.length < 60 && /&|Development|Design|Writing|Marketing|Data|AI|Automation|Scripting|Web|Mobile|Software|Engineering|Sales|Admin|Legal|Accounting|Translation|IT|Consulting|Labeling|Annotation/i.test(t) && !/^(Boosted|Boost outbid)$/i.test(t)) {
      const parent = badge.closest("section, [class*='section'], [class*='card'], [class*='detail']") || badge.parentElement?.parentElement;
      if (parent && /job\s*details|Posted/i.test(parent.innerText.slice(0, 200))) {
        proposal.jobCategory = t;
        break;
      }
    }
  }
  // Fallback: text regex
  if (!proposal.jobCategory) {
    const categoryMatch = text.match(/^([\w\s&]+?)\s{2,}Posted\s/m) ||
      text.match(/job\s*details[\s\S]*?\n(.+?)\s{2,}Posted\s/i) ||
      text.match(/job\s*details\s*\n[^\n]+\n\s*(.+?)\s+Posted\s/i);
    if (categoryMatch) {
      const cat = categoryMatch[1].trim();
      if (cat.length > 2 && cat.length < 60 && !isBadTitle(cat)) {
        proposal.jobCategory = cat;
      }
    }
  }

  // ── Submission timestamp — "Initiated Apr 27, 2026" or "Initiated Apr 27, 2026 at 3:45 PM" ──
  const initiatedMatch = text.match(
    /(?:Initiated|Received|Submitted)\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{4}(?:\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM))?)/i
  );
  if (initiatedMatch) proposal.submittedAt = initiatedMatch[1].trim();

  // ── Job Posted Date — "Posted Apr 16, 2026" ──
  const postedMatch = text.match(/Posted\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{4})/i);
  if (postedMatch) proposal.jobPostedDate = postedMatch[1].trim();

  // ── Job Budget — "$5.00 - $10.00 / Hourly range" or "$500.00 / Fixed-price" ──
  const hourlyRangeMatch = text.match(/\$([\d,.]+)\s*[-–]\s*\$([\d,.]+)\s*\/?\s*Hourly\s*range/i);
  if (hourlyRangeMatch) {
    proposal.jobBudget = `$${hourlyRangeMatch[1]} - $${hourlyRangeMatch[2]}/hr`;
  }
  if (!proposal.jobBudget) {
    const fixedMatch = text.match(/\$([\d,.]+)\s*\/?\s*Fixed[- ]?price/i);
    if (fixedMatch) proposal.jobBudget = "$" + fixedMatch[1];
  }
  if (!proposal.jobBudget) {
    const budgetMatch = text.match(/\$([\d,.]+)\s*\n?\s*(?:Fixed-price|fixed.price)/i);
    if (budgetMatch) proposal.jobBudget = "$" + budgetMatch[1];
  }

  // ── Experience Level — "Intermediate / Experience level" ──
  const expMatch = text.match(/(Entry[\s-]?level|Intermediate|Expert)\s*\/?\s*Experience\s*level/i) ||
    text.match(/(entry[\s-]?level|intermediate|expert)\b/i);
  if (expMatch) proposal.jobExperienceLevel = expMatch[1].trim();

  // ── Hours per week — "Less than 30 hrs/week / Hourly" ──
  const hoursMatch = text.match(/((?:Less than|More than)?\s*\d+\s*hrs?\s*\/\s*week)\s*\/?\s*Hourly/i) ||
    text.match(/((?:Less than|More than)?\s*\d+\s*hrs?\s*\/\s*week)/i);
  if (hoursMatch) proposal.jobHoursPerWeek = hoursMatch[1].trim();

  // ── Duration — "1 to 3 months / Project length" ──
  const durationMatch = text.match(/((?:\d+\s*to\s*\d+\s*(?:months?|weeks?|days?)|Less than (?:a )?(?:month|week)|More than \d+ months?))\s*\/?\s*Project\s*length/i) ||
    text.match(/((?:\d+\s*to\s*\d+\s*(?:months?|weeks?|days?)))/i);
  if (durationMatch) proposal.jobDuration = durationMatch[1].trim();

  // ── Job Description — text from Job details section ──
  const descMatch = text.match(/job\s*details\s*\n([\s\S]*?)(?=\nSkills and expertise|\nView job posting|\nBoosted proposal|\nCover letter|\nYour proposed)/i);
  if (descMatch) {
    // Clean out the title line, category line, and metadata lines
    let desc = descMatch[1].trim();
    // Remove lines that are clearly metadata (budget, experience, etc.)
    const descLines = desc.split("\n").filter((l) => {
      const trimmed = l.trim();
      if (!trimmed) return false;
      if (/^\$[\d,.]+\s*[-–]/.test(trimmed)) return false;
      if (/^\$[\d,.]+\s*$/.test(trimmed)) return false;
      if (/Experience\s*level$/i.test(trimmed)) return false;
      if (/Hourly\s*range$/i.test(trimmed)) return false;
      if (/Fixed[- ]?price$/i.test(trimmed)) return false;
      if (/hrs?\s*\/\s*week/i.test(trimmed)) return false;
      if (/Project\s*length$/i.test(trimmed)) return false;
      if (/Posted\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(trimmed)) return false;
      if (/^\/?(Entry|Intermediate|Expert)/i.test(trimmed)) return false;
      if (/^(Intermediate|Expert|Entry[\s-]?level)$/i.test(trimmed)) return false;
      if (/^(Hourly|Fixed-price|Less than|More than)$/i.test(trimmed)) return false;
      if (/^\d+\s*to\s*\d+\s*months?$/i.test(trimmed)) return false;
      // Filter category tags — short lines matching known Upwork categories
      if (/^(Scripting|Web Development|Software|Mobile|Data|Design|Writing|Admin|Sales|Marketing|IT|Engineering|Accounting|Legal|Customer|Translation|Ecommerce|Bot|AI|Machine|Blockchain|Cloud|DevOps|QA|Testing|SEO|Social|Video|Audio|Photo|Animation|Game|AR|VR)\s*[&\w\s]*$/i.test(trimmed) && trimmed.length < 40) return false;
      return true;
    });
    // Skip the first line if it looks like the title
    if (descLines.length > 1 && proposal.title && descLines[0].includes(proposal.title)) {
      descLines.shift();
    }
    // Also skip category-like first line
    if (descLines.length > 1 && proposal.jobCategory && descLines[0].includes(proposal.jobCategory)) {
      descLines.shift();
    }
    // Skip any remaining metadata lines at the start
    while (descLines.length > 0) {
      const first = descLines[0].trim();
      if (/^(Scripting|Web|Software|Mobile|Data|Design|Writing|Admin|Sales|IT|Bot|AI|Ecommerce)\b/i.test(first) && first.length < 40) {
        descLines.shift();
      } else if (/^Posted\s/i.test(first)) {
        descLines.shift();
      } else if (/^View\s*job\s*posting$/i.test(first)) {
        descLines.shift();
      } else {
        break;
      }
    }
    desc = descLines.join("\n").trim();
    // Remove "more", "less", "More/Less about" artifacts from expanded text
    desc = desc.replace(/\s*\bless\b\s*$/gim, "");
    desc = desc.replace(/\s*More\/Less about\s*/gi, "");
    desc = desc.replace(/\s*\bmore\b\s*$/gim, "");
    // Remove "Skills and expertise" heading and "View job posting" if leaked in
    desc = desc.replace(/^\s*Skills and expertise\s*$/gim, "");
    desc = desc.replace(/^\s*View job posting\s*$/gim, "");
    // Remove category tag if it leaked in
    if (proposal.jobCategory) {
      desc = desc.replace(new RegExp("^\\s*" + proposal.jobCategory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "gim"), "");
    }
    // Store raw description temporarily — will clean skill names after skills are extracted
    desc = desc.replace(/\n{3,}/g, "\n\n").trim();
    if (desc.length > 10) {
      proposal.jobDescription = desc;
    }
  }

  // ── Skills — prefer badge elements (clean separate values) over text parsing ──
  const skillEls = document.querySelectorAll('.air3-badge, [class*="skill-badge"], [data-test="skill"], .up-skill-badge, [class*="air3-token"], [class*="badge"]');
  const badgeSkills = Array.from(skillEls)
    .map((el) => el.textContent.trim())
    .filter((s) => s.length > 1 && s.length < 50 && !/^(Boosted|Boost outbid|General|Specialized|New)$/i.test(s));
  if (badgeSkills.length > 0) {
    proposal.jobSkills = [...new Set(badgeSkills)].slice(0, 30);
  } else {
    // Fallback: text parsing — but split concatenated skills by capital letters
    const skillsMatch = text.match(/skills\s*and\s*expertise\s*\n([\s\S]*?)(?=\nBoosted proposal|\nCover letter|\nYour proposed|\nAbout the client)/i);
    if (skillsMatch) {
      const raw = skillsMatch[1].trim();
      let skills = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && l.length < 50);
      // If only one long line, split by capital letter boundaries
      if (skills.length === 1 && skills[0].length > 30) {
        skills = skills[0].split(/(?<=[a-z])(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
      }
      if (skills.length > 0) proposal.jobSkills = skills;
    }
  }

  // ── Clean skill names from description (now that skills are extracted) ──
  if (proposal.jobDescription && proposal.jobSkills && proposal.jobSkills.length > 0) {
    let cleanDesc = proposal.jobDescription;
    for (const skill of proposal.jobSkills) {
      cleanDesc = cleanDesc.replace(new RegExp("^\\s*" + skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "gim"), "");
    }
    cleanDesc = cleanDesc.replace(/\n{3,}/g, "\n\n").trim();
    proposal.jobDescription = cleanDesc;
  }

  // ── Boosted proposal — "Your bid is set to 9 Connects." ──
  const bidMatch = text.match(/(?:bid|boost).*?(\d+)\s*Connects/i);
  if (bidMatch) proposal.bidConnects = parseInt(bidMatch[1]);

  // ── Cover letter (proposals) / Personal note from client (interviews) ──
  if (isInterview) {
    const noteMatch = text.match(/personal\s*note\s*from\s*client\s*\n([\s\S]*?)(?=\n\s*(?:About the client|Messages|View job|Decline|Accept|$))/i);
    if (noteMatch) proposal.clientNote = noteMatch[1].trim();
    // Fallback: section-element scan
    if (!proposal.clientNote) {
      const sections = document.querySelectorAll("section, [class*='section'], [class*='card']");
      for (const sec of sections) {
        if (sec.innerText.toLowerCase().startsWith("personal note from client")) {
          const fullText = sec.innerText.replace(/^personal\s*note\s*from\s*client\s*/i, "").trim();
          if (fullText.length) {
            proposal.clientNote = fullText;
            break;
          }
        }
      }
    }
  } else {
    const coverMatch = text.match(/cover\s*letter\s*\n([\s\S]*?)(?=\n\s*(?:Profile highlights|Messages|Client|About the client|Edit proposal|Withdraw proposal|Your proposed|Bid|Terms|Boosted proposal|How do you|Upgrade to))/i);
    if (coverMatch) {
      proposal.coverLetter = coverMatch[1].trim();
    }
    if (!proposal.coverLetter) {
      const sections = document.querySelectorAll("section, [class*='section'], [class*='card']");
      for (const sec of sections) {
        if (sec.innerText.toLowerCase().startsWith("cover letter")) {
          const fullText = sec.innerText.replace(/^cover\s*letter\s*/i, "").trim();
          if (fullText.length) {
            proposal.coverLetter = fullText;
            break;
          }
        }
      }
    }
  }

  // ── Your proposed terms ──
  const termsMatch = text.match(/your\s*proposed\s*terms\s*\n([\s\S]*?)(?=\nAbout the client|\nMessages|\nEdit proposal|\nWithdraw|$)/i);
  if (termsMatch) {
    const termsBlock = termsMatch[1];

    // Profile used — "Profile: General Profile"
    const profileMatch = termsBlock.match(/Profile\s*:?\s*(.+?)(?:\n|$)/i);
    if (profileMatch) proposal.profileUsed = profileMatch[1].trim();

    // Hourly rate — "Hourly rate: $10.00/hr"
    const rateMatch = termsBlock.match(/Hourly\s*rate\s*:?\s*\$([\d,.]+)\s*\/?\s*hr/i);
    if (rateMatch) proposal.proposedRate = "$" + rateMatch[1] + "/hr";

    // You'll receive — "You'll receive: $9.00/hr"
    const receiveMatch = termsBlock.match(/(?:You.ll|You will)\s*receive\s*:?\s*\$([\d,.]+)\s*\/?\s*hr/i);
    if (receiveMatch) proposal.receivedRate = "$" + receiveMatch[1] + "/hr";

    // Rate increase — "Rate increase: None" or "Rate increase: $5.00/hr after 3 months"
    const increaseMatch = termsBlock.match(/Rate\s*increase\s*:?\s*(.+?)(?:\n|$)/i);
    if (increaseMatch) proposal.rateIncrease = increaseMatch[1].trim();
  }

  // ── Viewed by client ──
  proposal.viewedByClient = /proposal\s*was\s*viewed|viewed\s*by\s*client/i.test(text);

  // ── Client name — from "Client" section (not "About the client") ──
  const clientNameMatch = text.match(/(?:^|\n)\s*Client\s*\n\s*(.+?)(?:\n|$)/);
  if (clientNameMatch) {
    const name = clientNameMatch[1].trim();
    if (name.length > 1 && name.length < 100 && !/payment|phone|verified|about\s*the/i.test(name)) {
      proposal.clientName = name;
    }
  }

  // ── About the client — full block parse (same approach as job scraper) ──
  const aboutMatch = text.match(/about\s*the\s*client([\s\S]*?)(?=\n\s*job\s*link|\n\s*similar\s*jobs|\n\s*how\s*it\s*works|\n\s*activity\s*on\s*this\s*job|\n\s*edit\s*proposal|\n\s*withdraw|$)/i);
  if (aboutMatch) {
    const block = aboutMatch[1];
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

    // Payment verified
    proposal.clientPaymentVerified = /payment\s*method\s*verified/i.test(block);

    // Rating — standalone float like "4.3"
    const ratingLine = lines.find((l) => /^\d+\.\d+$/.test(l));
    if (ratingLine) proposal.clientRating = parseFloat(ratingLine);

    // Review score — "4.27 of 19 reviews"
    const reviewMatch = block.match(/([\d.]+)\s*of\s*(\d+)\s*reviews?/i);
    if (reviewMatch) {
      proposal.clientReviewScore = reviewMatch[0].trim();
      proposal.clientReviews = parseInt(reviewMatch[2]);
      if (!proposal.clientRating) proposal.clientRating = parseFloat(reviewMatch[1]);
    }

    // Country & City
    const countryIdx = lines.findIndex((l) =>
      /^[A-Z]{2,4}$/.test(l) ||
      /^(United States|United Kingdom|Canada|Australia|India|Pakistan|Germany|France|Thailand|Philippines|Singapore|Netherlands|Israel|Brazil|Japan|China|South Korea|Spain|Italy|Sweden|Norway|Denmark|Switzerland|Ireland|New Zealand|Mexico|Argentina|Colombia|Chile|Egypt|Nigeria|Kenya|South Africa|UAE|Saudi Arabia|Bangladesh|Sri Lanka|Vietnam|Indonesia|Malaysia|Turkey|Poland|Ukraine|Romania|Czech Republic|Hungary|Portugal|Greece|Belgium|Austria|Finland|Russia|Belarus|Georgia|Armenia|Azerbaijan|Jordan|Lebanon|Qatar|Bahrain|Kuwait|Oman)$/i.test(l)
    );
    if (countryIdx !== -1) {
      proposal.clientCountry = lines[countryIdx];
      // Next line is typically "City  TIME"
      const nextLine = lines[countryIdx + 1];
      if (nextLine) {
        const cityMatch = nextLine.match(/^(.+?)\s{2,}/) || nextLine.match(/^(.+?)\s+\d{1,2}:\d{2}\s*(AM|PM|am|pm)/);
        if (cityMatch) proposal.clientCity = cityMatch[1].trim();
      }
    }

    // Jobs posted — "20 jobs posted"
    const jobsPostedMatch = block.match(/(\d+)\s*jobs?\s*posted/i);
    if (jobsPostedMatch) proposal.clientJobsPosted = parseInt(jobsPostedMatch[1]);

    // Hire rate & open jobs — "100% hire rate, 3 open jobs"
    const hireRateMatch = block.match(/(\d+)%\s*hire\s*rate/i);
    if (hireRateMatch) proposal.clientHireRate = parseInt(hireRateMatch[1]);
    const openJobsMatch = block.match(/(\d+)\s*open\s*jobs?/i);
    if (openJobsMatch) proposal.clientOpenJobs = parseInt(openJobsMatch[1]);

    // Total spent — "$11K total spent"
    const spentMatch = block.match(/\$([\d,.]+[KkMm]*\+?)\s*(?:total\s*)?spent/i);
    if (spentMatch) proposal.clientTotalSpent = "$" + spentMatch[1];

    // Hires & active — "48 hires, 13 active"
    const hiresMatch = block.match(/(\d+)\s*hires?\s*,?\s*(\d+)\s*active/i);
    if (hiresMatch) {
      proposal.clientHires = parseInt(hiresMatch[1]);
      proposal.clientActiveHires = parseInt(hiresMatch[2]);
    }

    // Avg hourly rate — "$5.15 /hr avg hourly rate paid"
    const avgRateMatch = block.match(/\$([\d,.]+)\s*\/?\s*hr\s*avg/i);
    if (avgRateMatch) proposal.clientAvgRate = "$" + avgRateMatch[1] + "/hr";

    // Total hours — "1,706 hours"
    const totalHoursMatch = block.match(/([\d,]+)\s*hours/i);
    if (totalHoursMatch) proposal.clientTotalHours = totalHoursMatch[1].replace(/,/g, "");

    // Member since — "Member since Jan 30, 2018"
    const memberMatch = block.match(/member\s*since\s*(.+?)(?:\n|$)/i);
    if (memberMatch) proposal.clientMemberSince = memberMatch[1].trim();
  }

  console.log("[UT] Proposal detail scraped:", JSON.stringify(proposal).slice(0, 500));

  if (proposal.title || proposal.coverLetter || proposal.clientNote) {
    sendToBackground("SCRAPED_PROPOSAL_DETAIL", proposal);
  }
}

// ── SCRAPER: Apply page (/nx/proposals/job/~.../apply) ──
// Binds a click-capture listener on the "Submit a Proposal" button and
// snapshots the form fields the moment the user commits to submit.
let applyListenerBound = false;
function watchApplyPage() {
  if (applyListenerBound) return;
  applyListenerBound = true;
  console.log("[UT] Watching apply page for submit click");

  // Capture on document level so we catch the click before React handlers
  document.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("button, [role='button']");
    if (!btn) return;
    const label = (btn.textContent || "").replace(/\s+/g, " ").trim();
    // Submit-proposal button variants on the apply page:
    //   "Send for N Connects"        (when Connects are charged)
    //   "Submit a Proposal" / "Submit Proposal"  (older / free submit)
    //   "Send Proposal"              (fallback)
    const submitPatterns = [
      /send\s+for\s+\d+\+?\s*connects?/i,
      /submit(\s+a)?\s+proposal/i,
      /send\s+proposal/i,
    ];
    if (!submitPatterns.some((re) => re.test(label))) return;

    let pending;
    try {
      pending = scrapeApplySubmission();
    } catch (e) {
      console.error("[UT] Apply scrape failed:", e);
      return;
    }
    if (!pending) return;

    // Only commit to DB if Upwork actually accepts the submit. Poll for ~6s:
    //   URL leaves /apply  → success, send
    //   validation errors visible → failure, discard
    //   timeout            → discard (safer than phantom rows)
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;

      if (!window.location.href.includes("/apply")) {
        clearInterval(timer);
        console.log("[UT] Submission confirmed by URL change; sending.");
        sendToBackground("SCRAPED_APPLY_SUBMIT", pending);
        return;
      }

      if (elapsed > 2000) {
        const errText = document.body.innerText;
        if (/\b(a cover letter is required|value is required and can't be empty|enter a rate-increase|this field is required)\b/i.test(errText)) {
          clearInterval(timer);
          console.log("[UT] Submission blocked by validation — discarded.");
          return;
        }
      }

      if (elapsed > 15000) {
        clearInterval(timer);
        console.log("[UT] Submission check timeout — discarded (no URL change).");
      }
    }, 300);
  }, true);
}

function scrapeApplySubmission() {
  const now = new Date().toISOString();
  const submission = {
    capturedAt: now,
    submittedAt: now,
    detailUrl: window.location.href,
    submittedViaExtension: true,
    section: "Submitted proposals",
  };

  // Job id/url from the apply URL
  const jobIdMatch = window.location.href.match(/\/job\/~(\w{15,})/);
  if (jobIdMatch) submission.url = "https://www.upwork.com/jobs/~" + jobIdMatch[1];
  
  const bodyText = document.body.innerText;

  // Title — try multiple strategies, in order of reliability:
  // 1. document.title (browser tab usually carries the job title)
  const tabTitle = (document.title || "").replace(/\s+/g, " ").trim();
  const tabMatch = tabTitle.match(/^(.+?)\s*[-–—]\s*Upwork/i) ||
    tabTitle.match(/^(.+?)\s*[-–—]\s*(Apply|Submit)/i);
  if (tabMatch) {
    const t = tabMatch[1].trim();
    if (t.length > 5 && t.length < 200 && !isBadTitle(t) && !/^(apply|submit|send)/i.test(t)) {
      submission.title = t;
    }
  }

  // 2. First heading that isn't a section label
  if (!submission.title) {
    const sectionLabels = /^(submit|apply|send|cover letter|additional details|profile highlights|boost your proposal|about the client|job details|skills and expertise|your bid|your proposed terms|rate|how often|how much|describe your|summary|proposals?)$/i;
    const headings = Array.from(document.querySelectorAll("h1, h2, h3"));
    for (const h of headings) {
      const t = (h.textContent || "").trim();
      if (t.length < 5 || t.length > 200) continue;
      if (isBadTitle(t)) continue;
      if (sectionLabels.test(t)) continue;
      submission.title = t;
      break;
    }
  }

  // 3. Parse from "Job details" block — title is usually first non-meta line
  if (!submission.title) {
    const jobDetailsMatch = bodyText.match(/job\s*details\s*\n\s*([^\n]+)/i);
    if (jobDetailsMatch) {
      const t = jobDetailsMatch[1].trim();
      if (t.length > 5 && !isBadTitle(t) && !/^(Posted|Hourly|Fixed|Entry|Intermediate|Expert|\$|Less than|More than)/i.test(t)) {
        submission.title = t;
      }
    }
  }

  // 4. Any visible /jobs/~ link with non-trivial text
  if (!submission.title) {
    const links = Array.from(document.querySelectorAll('a[href*="/jobs/~"]'));
    for (const link of links) {
      const t = link.textContent?.trim() || "";
      if (t.length > 5 && !isBadTitle(t) && !/^view\s+job/i.test(t)) {
        submission.title = t;
        break;
      }
    }
  }

  // Cover letter: combine ALL non-empty textareas on the page (Upwork's apply
  // page has "Cover Letter" + "Describe your recent experience…"). Labels are
  // prefixed so each section is identifiable when read back on the dashboard.
  const textareas = Array.from(document.querySelectorAll("textarea"));
  const coverParts = [];
  for (const ta of textareas) {
    const v = (ta.value || "").trim();
    if (v.length < 2) continue;

    let labelText = "";
    if (ta.id) {
      const lbl = document.querySelector(`label[for="${ta.id}"]`);
      if (lbl) labelText = (lbl.textContent || "").trim();
    }
    if (!labelText) {
      let parent = ta.parentElement;
      for (let i = 0; i < 4 && parent; i++) {
        const lbl = parent.querySelector("label");
        if (lbl) { labelText = (lbl.textContent || "").trim(); break; }
        parent = parent.parentElement;
      }
    }

    coverParts.push(labelText ? `${labelText}:\n${v}` : v);
  }
  if (coverParts.length > 0) submission.coverLetter = coverParts.join("\n\n");

  // Proposed rate: number input near "hourly rate" label, or any $-prefixed input
  const rateInputs = Array.from(document.querySelectorAll('input[type="number"], input[type="text"]'))
    .filter((i) => {
      const nearby = (i.closest("label, [class*='field'], [class*='form-group'], div")?.innerText || "").toLowerCase();
      return /hourly|rate|bid|price/.test(nearby);
    });
  for (const input of rateInputs) {
    const v = String(input.value || "").trim();
    if (/^\d+(\.\d+)?$/.test(v)) {
      submission.proposedRate = "$" + v + (/hourly/i.test(bodyText) ? "/hr" : "");
      break;
    }
  }

  // Connects charged for this submission — from the Summary block's Total line.
  // (Not "Your bid 51 Connects or higher…" which is just the rank hint.)
  const totalMatch = bodyText.match(/Summary[\s\S]{0,400}?\bTotal\s*:?\s*\n?\s*(\d+)\s*Connects/i);
  if (totalMatch) {
    submission.bidConnects = parseInt(totalMatch[1]);
  } else {
    const reqMatch = bodyText.match(/Required\s+for\s+proposal\s*:?\s*\n?\s*(\d+)\s*Connects/i);
    if (reqMatch) submission.bidConnects = parseInt(reqMatch[1]);
  }

  // Profile used: a "Profile:" field or the selected profile label
  const profileMatch = bodyText.match(/Profile\s*:?\s*([A-Z][A-Za-z ]{2,30}\s+Profile)/);
  if (profileMatch) submission.profileUsed = profileMatch[1].trim();

  // Job category: badge near the job title
  const catBadges = document.querySelectorAll('.air3-badge, [class*="badge"], [class*="token"]');
  for (const b of catBadges) {
    const t = b.textContent?.trim() || "";
    if (t.length > 3 && t.length < 60 && /Development|Design|Writing|Marketing|Data|AI|Automation|Web|Mobile|Engineering/i.test(t)) {
      submission.jobCategory = t;
      break;
    }
  }

  // ── Job posted date ──
  const postedMatch = bodyText.match(/Posted\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{4})/i);
  if (postedMatch) submission.jobPostedDate = postedMatch[1].trim();

  // ── Job budget ──
  const hourlyRangeMatch = bodyText.match(/\$([\d,.]+)\s*[-–]\s*\$([\d,.]+)\s*\/?\s*Hourly\s*range/i);
  if (hourlyRangeMatch) {
    submission.jobBudget = `$${hourlyRangeMatch[1]} - $${hourlyRangeMatch[2]}/hr`;
  }
  if (!submission.jobBudget) {
    const fixedMatch = bodyText.match(/\$([\d,.]+)\s*\/?\s*Fixed[- ]?price/i);
    if (fixedMatch) submission.jobBudget = "$" + fixedMatch[1];
  }

  // ── Experience level / hours / duration ──
  const expMatch = bodyText.match(/(Entry[\s-]?level|Intermediate|Expert)\s*\/?\s*Experience\s*level/i) ||
    bodyText.match(/\b(Entry[\s-]?level|Intermediate|Expert)\b/);
  if (expMatch) submission.jobExperienceLevel = expMatch[1].trim();

  const hoursMatch = bodyText.match(/((?:Less than|More than)?\s*\d+\s*hrs?\s*\/\s*week)\s*\/?\s*Hourly/i) ||
    bodyText.match(/((?:Less than|More than)?\s*\d+\s*hrs?\s*\/\s*week)/i);
  if (hoursMatch) submission.jobHoursPerWeek = hoursMatch[1].trim();

  const durationMatch = bodyText.match(/((?:\d+\s*to\s*\d+\s*(?:months?|weeks?|days?)|Less than (?:a )?(?:month|week)|More than \d+ months?))\s*\/?\s*Project\s*length/i) ||
    bodyText.match(/((?:\d+\s*to\s*\d+\s*(?:months?|weeks?|days?)))/i);
  if (durationMatch) submission.jobDuration = durationMatch[1].trim();

  // ── Job description — parse block under "Job details" heading ──
  const descMatch = bodyText.match(/job\s*details\s*\n([\s\S]*?)(?=\nSkills and expertise|\nView job posting|\nBoost your proposal|\nProfile highlights|\nBoosted proposal|\nCover letter|\nYour proposed|$)/i);
  if (descMatch) {
    let desc = descMatch[1].trim();
    const descLines = desc.split("\n").filter((l) => {
      const trimmed = l.trim();
      if (!trimmed) return false;
      if (/^\$[\d,.]+\s*[-–]/.test(trimmed)) return false;
      if (/^\$[\d,.]+\s*$/.test(trimmed)) return false;
      if (/Experience\s*level$/i.test(trimmed)) return false;
      if (/Hourly\s*range$/i.test(trimmed)) return false;
      if (/Fixed[- ]?price$/i.test(trimmed)) return false;
      if (/hrs?\s*\/\s*week/i.test(trimmed)) return false;
      if (/Project\s*length$/i.test(trimmed)) return false;
      if (/Posted\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(trimmed)) return false;
      if (/^(Intermediate|Expert|Entry[\s-]?level)$/i.test(trimmed)) return false;
      if (/^(Hourly|Fixed-price|Less than|More than)$/i.test(trimmed)) return false;
      if (/^\d+\s*to\s*\d+\s*months?$/i.test(trimmed)) return false;
      return true;
    });
    if (descLines.length > 1 && submission.title && descLines[0].includes(submission.title)) {
      descLines.shift();
    }
    if (descLines.length > 1 && submission.jobCategory && descLines[0].includes(submission.jobCategory)) {
      descLines.shift();
    }
    desc = descLines.join("\n").trim().replace(/\n{3,}/g, "\n\n");
    if (desc.length > 10) submission.jobDescription = desc;
  }

  // ── Skills ──
  const skillEls = document.querySelectorAll('.air3-badge, [class*="skill-badge"], [data-test="skill"], .up-skill-badge, [class*="air3-token"]');
  const badgeSkills = Array.from(skillEls)
    .map((el) => el.textContent.trim())
    .filter((s) => s.length > 1 && s.length < 50 && !/^(Boosted|Boost outbid|General|Specialized|New)$/i.test(s));
  if (badgeSkills.length > 0) {
    submission.jobSkills = [...new Set(badgeSkills)].slice(0, 30);
  }
  // Remove skill names from description if they leaked in
  if (submission.jobDescription && submission.jobSkills?.length) {
    let cleanDesc = submission.jobDescription;
    for (const skill of submission.jobSkills) {
      cleanDesc = cleanDesc.replace(new RegExp("^\\s*" + skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "gim"), "");
    }
    submission.jobDescription = cleanDesc.replace(/\n{3,}/g, "\n\n").trim();
  }

  // ── Client name ──
  const clientNameMatch = bodyText.match(/(?:^|\n)\s*Client\s*\n\s*(.+?)(?:\n|$)/);
  if (clientNameMatch) {
    const name = clientNameMatch[1].trim();
    if (name.length > 1 && name.length < 100 && !/payment|phone|verified|about\s*the/i.test(name)) {
      submission.clientName = name;
    }
  }

  // ── About the client — full block parse ──
  const aboutMatch = bodyText.match(/about\s*the\s*client([\s\S]*?)(?=\n\s*job\s*link|\n\s*similar\s*jobs|\n\s*how\s*it\s*works|\n\s*activity\s*on\s*this\s*job|\n\s*send\s+for|\n\s*send\s+proposal|\n\s*cancel|$)/i);
  if (aboutMatch) {
    const block = aboutMatch[1];
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

    submission.clientPaymentVerified = /payment\s*method\s*verified/i.test(block);

    const ratingLine = lines.find((l) => /^\d+\.\d+$/.test(l));
    if (ratingLine) submission.clientRating = parseFloat(ratingLine);

    const reviewMatch = block.match(/([\d.]+)\s*of\s*(\d+)\s*reviews?/i);
    if (reviewMatch) {
      submission.clientReviewScore = reviewMatch[0].trim();
      submission.clientReviews = parseInt(reviewMatch[2]);
      if (!submission.clientRating) submission.clientRating = parseFloat(reviewMatch[1]);
    }

    const countryIdx = lines.findIndex((l) =>
      /^[A-Z]{2,4}$/.test(l) ||
      /^(United States|United Kingdom|Canada|Australia|India|Pakistan|Germany|France|Thailand|Philippines|Singapore|Netherlands|Israel|Brazil|Japan|China|South Korea|Spain|Italy|Sweden|Norway|Denmark|Switzerland|Ireland|New Zealand|Mexico|Argentina|Colombia|Chile|Egypt|Nigeria|Kenya|South Africa|UAE|Saudi Arabia|Bangladesh|Sri Lanka|Vietnam|Indonesia|Malaysia|Turkey|Poland|Ukraine|Romania|Czech Republic|Hungary|Portugal|Greece|Belgium|Austria|Finland|Russia|Belarus|Georgia|Armenia|Azerbaijan|Jordan|Lebanon|Qatar|Bahrain|Kuwait|Oman|Luxembourg)$/i.test(l)
    );
    if (countryIdx !== -1) {
      submission.clientCountry = lines[countryIdx];
      const nextLine = lines[countryIdx + 1];
      if (nextLine) {
        const cityMatch = nextLine.match(/^(.+?)\s{2,}/) || nextLine.match(/^(.+?)\s+\d{1,2}:\d{2}\s*(AM|PM|am|pm)/);
        if (cityMatch) submission.clientCity = cityMatch[1].trim();
      }
    }

    const jobsPostedMatch = block.match(/(\d+)\s*jobs?\s*posted/i);
    if (jobsPostedMatch) submission.clientJobsPosted = parseInt(jobsPostedMatch[1]);

    const hireRateMatch = block.match(/(\d+)%\s*hire\s*rate/i);
    if (hireRateMatch) submission.clientHireRate = parseInt(hireRateMatch[1]);
    const openJobsMatch = block.match(/(\d+)\s*open\s*jobs?/i);
    if (openJobsMatch) submission.clientOpenJobs = parseInt(openJobsMatch[1]);

    const spentMatch = block.match(/\$([\d,.]+[KkMm]*\+?)\s*(?:total\s*)?spent/i);
    if (spentMatch) submission.clientTotalSpent = "$" + spentMatch[1];

    const hiresMatch = block.match(/(\d+)\s*hires?\s*,?\s*(\d+)\s*active/i);
    if (hiresMatch) {
      submission.clientHires = parseInt(hiresMatch[1]);
      submission.clientActiveHires = parseInt(hiresMatch[2]);
    }

    const avgRateMatch = block.match(/\$([\d,.]+)\s*\/?\s*hr\s*avg/i);
    if (avgRateMatch) submission.clientAvgRate = "$" + avgRateMatch[1] + "/hr";

    const totalHoursMatch = block.match(/([\d,]+)\s*hours/i);
    if (totalHoursMatch) submission.clientTotalHours = totalHoursMatch[1].replace(/,/g, "");

    const memberMatch = block.match(/member\s*since\s*(.+?)(?:\n|$)/i);
    if (memberMatch) submission.clientMemberSince = memberMatch[1].trim();
  }

  console.log("[UT] Apply submission scraped:", JSON.stringify(submission).slice(0, 800));

  if (submission.title || submission.coverLetter) return submission;
  return null;
}

// ── SCRAPER: Job Feed ──
function scrapeFeed() {
  console.log("[UT] Scraping job feed...");

  const jobs = [];
  const jobLinks = document.querySelectorAll('a[href*="/jobs/~"]');
  const seen = new Set();

  for (const link of jobLinks) {
    const href = link.href;
    const title = link.textContent.trim();

    // Skip bad titles
    if (isBadTitle(title)) continue;

    // Clean URL — strip query params for dedup
    const cleanHref = href.split("?")[0];
    if (seen.has(cleanHref)) continue;
    seen.add(cleanHref);

    if (title.length > 300) continue;

    // Skip links inside the detail panel — only scrape from the feed list
    const inPanel = link.closest('[class*="drawer"], [class*="panel"], [class*="slider"], [role="dialog"]');
    if (inPanel) continue;

    const job = { title, url: cleanHref };
    const card = link.closest("article, section, [class*='card'], [class*='tile'], [class*='job'], div[class]");
    if (card) {
      const cardText = card.innerText;
      const budgetMatch = cardText.match(/(?:est\.?\s*budget|budget)\s*:?\s*\$?([\d,]+)/i);
      if (budgetMatch) job.budget = "$" + budgetMatch[1];
      if (!job.budget) {
        const hourlyMatch = cardText.match(/\$([\d,.]+)\s*[-–]\s*\$([\d,.]+)/);
        if (hourlyMatch) job.budget = `$${hourlyMatch[1]} - $${hourlyMatch[2]}`;
      }
      if (/fixed.price/i.test(cardText)) job.jobType = "fixed";
      else if (/hourly/i.test(cardText)) job.jobType = "hourly";
      const levelMatch = cardText.match(/(entry[\s-]level|intermediate|expert)/i);
      if (levelMatch) job.experienceLevel = levelMatch[1];
      const skillEls = card.querySelectorAll('.air3-badge, [class*="skill"], .up-skill-badge');
      if (skillEls.length > 0) {
        job.skills = Array.from(skillEls).map((el) => el.textContent.trim()).filter((s) => s.length > 0 && s.length < 50).slice(0, 15);
      }
    }
    jobs.push(job);
  }

  if (jobs.length > 0) {
    console.log("[UT] Found", jobs.length, "jobs in feed");
    sendToBackground("SCRAPED_FEED", { jobs: jobs.slice(0, 50), capturedAt: new Date().toISOString() });
  }
}

// ── Detect if a job detail panel/drawer is open ──
function isJobPanelOpen() {
  // Look for "Open job in a new window" link — indicates job detail is showing
  const openLink = document.querySelector('a[href*="/jobs/~"]');
  if (openLink && /open\s*job/i.test(openLink.textContent)) return true;

  // Look for a visible panel/drawer with job-like content
  const panels = document.querySelectorAll('[class*="drawer"], [class*="panel"], [class*="slider"], [role="dialog"]');
  for (const p of panels) {
    if (p.offsetHeight > 200 && p.innerText.includes("Send a proposal")) return true;
  }

  return false;
}

// Track which job URLs we already scraped in this session to avoid duplicates
const scrapedJobUrls = new Set();

// ── Always try to identify the user on ANY page ──
function identifyUser() {
  // Try all sources to find a userId
  const userId = extractUserId();
  if (userId) {
    console.log("[UT] User identified:", userId);
    sendToBackground("SAVE_ACCOUNT_INFO", { userId });
    return;
  }

  // Also look for the user's name in the nav bar (top-right profile area)
  const navProfileLink = document.querySelector('a[href*="/freelancers/~"]');
  if (navProfileLink) {
    const m = navProfileLink.href.match(/\/freelancers\/~(\w+)/);
    if (m) {
      console.log("[UT] User identified from nav link:", m[1]);
      sendToBackground("SAVE_ACCOUNT_INFO", { userId: m[1], name: navProfileLink.textContent.trim() || null });
      return;
    }
  }

  // Try getting it from the page's fetch headers or embedded data
  const allScripts = document.querySelectorAll("script");
  for (const s of allScripts) {
    const text = s.textContent || "";
    // Look for visitor/user ID patterns in any script
    const match = text.match(/"(?:visitorId|userId|uid|personUid|ciphertext|freelancerId)"\s*:\s*"?(\w{10,})"?/);
    if (match) {
      console.log("[UT] User identified from script tag:", match[1]);
      sendToBackground("SAVE_ACCOUNT_INFO", { userId: match[1] });
      return;
    }
  }

  console.log("[UT] Could not identify user on this page");
}

// ── SCRAPER: Messages page (/ab/messages/ or /nx/messages/) ──
function scrapeMessages() {
  console.log("[UT] Scraping messages page...");

  const messages = [];

  // ── 1. SIDEBAR: Scrape conversation list ──
  // Each conversation in the left sidebar shows:
  //   "Abdullah Javaid, A...  2/25/26"
  //   "Build a Simple AI Automation t..."
  //   "You: Abdullah Javaid ?"   ← "You:" prefix = freelancer replied
  // Rows are links to /ab/messages/rooms/room_xxx

  const roomLinks = document.querySelectorAll('a[href*="/messages/rooms/"], a[href*="/rooms/room_"]');
  const seenRooms = new Set();

  for (const link of roomLinks) {
    const href = link.href;
    const roomMatch = href.match(/room_[a-f0-9]+/);
    if (!roomMatch || seenRooms.has(roomMatch[0])) continue;
    seenRooms.add(roomMatch[0]);

    // Read text from the link itself — Nuxt wraps the full sidebar card inside <a>.
    // Only walk up if the link is too short, and stop before a parent contains another room link.
    let rowEl = link;
    let text = (link.innerText || "").trim();
    if (text.length < 20) {
      let node = link.parentElement;
      while (node && node !== document.body) {
        if (node.querySelectorAll('a[href*="/messages/rooms/"]').length > 1) break;
        const t = (node.innerText || "").trim();
        if (t.length > text.length) { text = t; rowEl = node; }
        if (text.length > 20) break;
        node = node.parentElement;
      }
    }
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    // Strip leading avatar initials (e.g. "AF" when the row has no profile photo)
    while (lines.length && /^[A-Z]{1,3}$/.test(lines[0])) lines.shift();
    if (lines.length < 2) continue;

    const msg = {
      type: "message",
      roomId: roomMatch[0],
      url: href.split("?")[0],
    };

    // Line 1: "Abdullah Javaid, A...  2/25/26" — name + date
    const firstLine = lines[0];
    const nameDateMatch = firstLine.match(/^(.+?)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})$/);
    if (nameDateMatch) {
      msg.senderName = nameDateMatch[1].trim();
      msg.date = nameDateMatch[2];
    } else {
      msg.senderName = firstLine.slice(0, 60);
    }

    msg.freelancerReplied = true; // default safe
    msg.jobTitle = null;
    msg.preview = null;

    for (let li = 1; li < lines.length; li++) {
      const line = lines[li];

      if (/^You\s*:/i.test(line)) {
        msg.preview = line.slice(0, 200);
        msg.freelancerReplied = true;
        break;
      }

      if (/ended the|declined|sent an offer|accepted|started|completed|closed|left feedback/i.test(line)) {
        msg.preview = line.slice(0, 200);
        msg.freelancerReplied = true;
        break;
      }

      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(line)) continue;

      if (!msg.jobTitle) {
        msg.jobTitle = line;
        continue;
      }

      if (!msg.preview) {
        msg.preview = line.slice(0, 200);
        msg.freelancerReplied = false;
        break;
      }
    }

    // Strict unread detection — only trust aria-label. Bold/dot heuristics
    // false-positive on initials and system-action text.
    const ariaLabel = (link.getAttribute("aria-label") || "").toLowerCase();
    msg.isUnread = /\bunread\b|\bnew message\b/.test(ariaLabel);

    msg.title = `Message from ${msg.senderName || "Unknown"}`;
    messages.push(msg);
  }

  // Split: conversations needing attention vs already replied
  const needAttention = messages.filter((m) => !m.freelancerReplied || m.isUnread);
  const nowReplied = messages.filter((m) => m.freelancerReplied && !m.isUnread);

  console.log("[UT] Scraped", messages.length, "conversations,", needAttention.length, "need attention,", nowReplied.length, "replied");
  console.log("[UT] Conversations:", messages.map((m) => `${m.senderName}: replied=${m.freelancerReplied}, unread=${m.isUnread}`).join(" | "));

  if (needAttention.length > 0 || nowReplied.length > 0) {
    sendToBackground("SCRAPED_MESSAGES", {
      needAttention: needAttention.map((m) => ({
        ...m,
        needsAttention: true,
      })),
      nowReplied: nowReplied.map((m) => ({
        ...m,
        needsAttention: false,
      })),
    });
  }
}

// ── SCRAPER: Apply page (/nx/proposals/job/~.../apply/) ──
function scrapeApplyPage() {
  // Cover letter — typically the only <textarea> on this page
  let coverLetter = "";
  const coverLabel = Array.from(document.querySelectorAll('label, h2, h3, h4, span, div'))
    .find((el) => el.textContent.trim() === "Cover Letter");
  if (coverLabel) {
    let container = coverLabel.parentElement;
    let textarea = null;
    while (container && !textarea) {
      textarea = container.querySelector('textarea');
      container = container.parentElement;
    }
    if (textarea) coverLetter = textarea.value || "";
  }
  if (!coverLetter) {
    const ta = document.querySelector('textarea');
    if (ta) coverLetter = ta.value || "";
  }

  // Job details — multi-strategy
  let jobTitle = "", jobDescription = "", jobCategory = "",
      budget = "", experienceLevel = "", projectLength = "";

  // Strategy 1: find ANY element whose text is exactly "Job details"
  let jobSection = null;
  const allEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, [role="heading"]');
  for (const el of allEls) {
    if (el.textContent.trim() === "Job details") {
      let container = el.closest('section') || el.parentElement;
      // Walk up until we get a container with substantial text
      while (container && (container.innerText || "").length < 300 && container.parentElement) {
        container = container.parentElement;
      }
      jobSection = container;
      break;
    }
  }

  // Strategy 2: anchor on "View job posting" link and walk up
  if (!jobSection) {
    const viewLink = Array.from(document.querySelectorAll('a, button'))
      .find((el) => /^view job posting/i.test(el.textContent.trim()));
    if (viewLink) {
      let container = viewLink.parentElement;
      while (container && (container.innerText || "").length < 500 && container.parentElement) {
        container = container.parentElement;
      }
      jobSection = container;
    }
  }

  // Strategy 3: whole body, minus the cover letter
  let sourceText = jobSection ? (jobSection.innerText || "") : (document.body.innerText || "");
  if (!jobSection && coverLetter) sourceText = sourceText.replace(coverLetter, "");

  // Title: prefer the first non-"Job details" heading inside the section
  if (jobSection) {
    const innerHeadings = jobSection.querySelectorAll('h1, h2, h3');
    for (const h of innerHeadings) {
      const t = h.textContent.trim();
      if (t && t !== "Job details" && t.length > 3 && t.length < 200) { jobTitle = t; break; }
    }
  }

  const lines = sourceText.split("\n").map((l) => l.trim()).filter(Boolean);

  // Sidebar metadata (works regardless of which strategy found the section)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!experienceLevel && /^(Entry level|Intermediate|Expert)$/i.test(l)) experienceLevel = l;
    if (!budget && /^\$[\d,.]+/.test(l) && /fixed|hour/i.test(lines[i + 1] || "")) budget = l;
    if (!projectLength && /(Less than|1 to|3 to|More than).*month/i.test(l)) projectLength = l;
  }

  // Description: skip known boilerplate, keep everything else
  const skipExact = new Set([
    "Job details", "Experience level", "Project length", "Fixed-price", "Hourly",
    "less", "more", "Intermediate", "Entry level", "Expert",
    jobTitle, experienceLevel, budget, projectLength,
  ].filter(Boolean));
  const skipPrefix = /^(Posted |View job posting|Upgrade now|Reactivate )/i;

  const titleIdx = jobTitle ? lines.findIndex((l) => l === jobTitle) : -1;
  const startIdx = titleIdx >= 0 ? titleIdx + 1 : 0;
  const descLines = [];
  for (let i = startIdx; i < lines.length; i++) {
    const l = lines[i];
    if (skipExact.has(l)) continue;
    if (skipPrefix.test(l)) continue;
    if (l === jobCategory) continue;
    descLines.push(l);
  }
  jobDescription = descLines.join("\n").trim();

  // Category — chip/badge inside the section
  if (jobSection) {
    const chips = jobSection.querySelectorAll('button, [class*="chip"], [class*="badge"], [class*="pill"], [class*="tag"]');
    for (const c of chips) {
      const t = c.textContent.trim();
      if (t && t.length > 3 && t.length < 50 && t !== jobTitle &&
          !/posted|view|less|more|upgrade|reactivate|cover letter|attach/i.test(t)) {
        jobCategory = t; break;
      }
    }
  }

  console.log("[UT] Apply page scraped:", {
    coverLetterLen: coverLetter.length,
    jobTitle, jobCategory, budget, experienceLevel, projectLength,
    descLen: jobDescription.length,
    sectionFound: !!jobSection,
  });

  return { coverLetter, jobTitle, jobDescription, jobCategory, budget, experienceLevel, projectLength };
}

// ── PANEL: Floating "Analyze Cover Letter" widget on apply pages ──
let analysisPanelInjected = false;
function injectAnalysisPanel() {
  if (analysisPanelInjected) return;
  if (document.getElementById("ut-analysis-panel")) { analysisPanelInjected = true; return; }
  analysisPanelInjected = true;

  const panel = document.createElement("div");
  panel.id = "ut-analysis-panel";
  panel.setAttribute("style", [
    "position:fixed", "right:20px", "bottom:20px", "width:380px", "max-height:75vh",
    "background:#ffffff", "color:#0e1925", "border:1px solid #d5dde5", "border-radius:12px",
    "box-shadow:0 10px 40px rgba(14,25,37,0.18)", "z-index:2147483647",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    "font-size:14px", "display:flex", "flex-direction:column", "overflow:hidden",
  ].join(";"));

  panel.innerHTML = `
    <div id="ut-panel-header" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#108a00;color:#fff;cursor:move;">
      <div style="font-weight:600;font-size:14px;">Cover Letter Analyzer</div>
      <div style="display:flex;gap:8px;">
        <button id="ut-panel-min" style="background:transparent;color:#fff;border:0;cursor:pointer;font-size:18px;line-height:1;padding:0 4px;" title="Minimize">—</button>
        <button id="ut-panel-close" style="background:transparent;color:#fff;border:0;cursor:pointer;font-size:18px;line-height:1;padding:0 4px;" title="Close">✕</button>
      </div>
    </div>
    <div id="ut-panel-body" style="padding:14px;overflow-y:auto;flex:1;">
      <button id="ut-analyze-btn" style="width:100%;padding:10px 14px;background:#108a00;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px;">Analyze Cover Letter</button>
      <div id="ut-status" style="margin-top:10px;color:#5e6d7e;font-size:12px;"></div>
      <div id="ut-results" style="margin-top:14px;"></div>
    </div>
  `;
  document.body.appendChild(panel);

  // Drag
  const header = panel.querySelector("#ut-panel-header");
  let dragging = false, offX = 0, offY = 0;
  header.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    offX = e.clientX - rect.left;
    offY = e.clientY - rect.top;
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    panel.style.left = (e.clientX - offX) + "px";
    panel.style.top = (e.clientY - offY) + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  });
  document.addEventListener("mouseup", () => { dragging = false; });

  // Minimize/close
  const body = panel.querySelector("#ut-panel-body");
  panel.querySelector("#ut-panel-min").addEventListener("click", () => {
    body.style.display = body.style.display === "none" ? "block" : "none";
  });
  panel.querySelector("#ut-panel-close").addEventListener("click", () => {
    panel.remove();
    analysisPanelInjected = false;
  });

  // Analyze
  panel.querySelector("#ut-analyze-btn").addEventListener("click", () => {
    runAnalysis(panel);
  });
}

function runAnalysis(panel) {
  const status = panel.querySelector("#ut-status");
  const results = panel.querySelector("#ut-results");
  const btn = panel.querySelector("#ut-analyze-btn");

  const data = scrapeApplyPage();
  if (!data.coverLetter || data.coverLetter.trim().length < 10) {
    status.textContent = "Cover letter is empty or too short to analyze.";
    status.style.color = "#c0392b";
    results.innerHTML = "";
    return;
  }
  if (!data.jobDescription) {
    status.textContent = "Couldn't find the job description on this page.";
    status.style.color = "#c0392b";
    results.innerHTML = "";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Analyzing…";
  btn.style.background = "#5e6d7e";
  status.textContent = `Sending ${data.coverLetter.length} chars to Gemini…`;
  status.style.color = "#5e6d7e";
  results.innerHTML = "";

  chrome.runtime.sendMessage({ type: "ANALYZE_COVER_LETTER", payload: data }, (r) => {
    btn.disabled = false;
    btn.textContent = "Re-analyze";
    btn.style.background = "#108a00";
    if (chrome.runtime.lastError) {
      status.textContent = "Extension error: " + chrome.runtime.lastError.message;
      status.style.color = "#c0392b";
      return;
    }
    if (!r || !r.ok) {
      status.textContent = "Analyze failed: " + (r?.error || "unknown error");
      status.style.color = "#c0392b";
      if (r?.detail) status.textContent += " — " + r.detail;
      return;
    }
    status.textContent = "";
    renderAnalysis(results, r.analysis);
  });
}

function renderAnalysis(container, a) {
  if (!a) { container.innerHTML = "<div style='color:#c0392b;'>Empty analysis.</div>"; return; }
  const score = Number(a.score) || 0;
  const scoreColor = score >= 80 ? "#108a00" : score >= 60 ? "#d49000" : "#c0392b";
  const sevColor = { critical: "#c0392b", major: "#d49000", minor: "#5e6d7e" };
  const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let html = "";
  html += `<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px;">
    <div style="font-size:38px;font-weight:700;color:${scoreColor};line-height:1;">${score}</div>
    <div style="color:#5e6d7e;font-size:12px;">/100</div>
  </div>`;
  if (a.summary) {
    html += `<div style="margin-bottom:14px;color:#0e1925;line-height:1.45;">${esc(a.summary)}</div>`;
  }
  if (Array.isArray(a.strengths) && a.strengths.length) {
    html += `<div style="margin-bottom:12px;"><div style="font-weight:600;margin-bottom:6px;color:#108a00;">Strengths</div><ul style="margin:0;padding-left:18px;color:#0e1925;">`;
    for (const s of a.strengths) html += `<li style="margin-bottom:4px;">${esc(s)}</li>`;
    html += `</ul></div>`;
  }
  if (Array.isArray(a.issues) && a.issues.length) {
    html += `<div><div style="font-weight:600;margin-bottom:6px;">Issues (${a.issues.length})</div>`;
    for (const i of a.issues) {
      const c = sevColor[i.severity] || "#5e6d7e";
      html += `<div style="border-left:3px solid ${c};padding:8px 10px;margin-bottom:8px;background:#f7f9fb;border-radius:4px;">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
          <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:${c};">${esc(i.severity)}</span>
          <span style="font-size:10px;color:#5e6d7e;text-transform:uppercase;">${esc(i.category)}</span>
        </div>
        <div style="margin-bottom:6px;color:#0e1925;line-height:1.4;">${esc(i.message)}</div>
        <div style="font-size:12px;color:#5e6d7e;line-height:1.4;"><b>Fix:</b> ${esc(i.fix)}</div>
      </div>`;
    }
    html += `</div>`;
  } else {
    html += `<div style="color:#108a00;">No issues found.</div>`;
  }
  container.innerHTML = html;
}

// ── Page router ──
function detectPageAndScrape() {
  const url = window.location.href;
  console.log("[UT] Detecting page type for:", url);

  // ALWAYS try to identify the user on every page
  identifyUser();

  // Full profile scraping only on freelancer profile page
  if (url.includes("/freelancers/")) {
    const pageProfileId = url.match(/\/freelancers\/~(\w+)/)?.[1];
    chrome.storage.local.get(["canonicalUserId"], (data) => {
      if (!data.canonicalUserId) {
        console.log("[UT] Skip profile scrape: no canonical user yet");
        return;
      }
      if (pageProfileId && pageProfileId !== data.canonicalUserId) {
        console.log("[UT] Skip profile scrape: not own profile", pageProfileId, "vs", data.canonicalUserId);
        return;
      }
      scrapeAccount();
    });
  }

  // Scrape messages page for unread messages
  if (url.includes("/nx/messages") || url.includes("/ab/messages")) {
    scrapeMessages();
  }

  // Apply page — must check BEFORE the generic /proposals/job/ job route,
  // otherwise it would get caught by scrapeJob().
  if (url.match(/\/proposals\/job\/~[^/]+\/apply/)) {
    watchApplyPage();
    // injectAnalysisPanel();
    return;
  }

  if (url.includes("/nx/my-stats") || url.includes("/my-stats")) {
    scrapeStats();
  } else if (url.match(/\/jobs\/~/) || url.match(/\/ab\/proposals\/job\//) || url.match(/\/nx\/proposals\/job\//)) {
    scrapeJob();
  } else if (url.match(/\/nx\/proposals\/interview\/uid\/\d+/) || url.match(/\/ab\/proposals\/interview\/uid\/\d+/)) {
    scrapeProposalDetail();
  } else if (url.match(/\/nx\/proposals\/\d+/) || url.match(/\/ab\/proposals\/\d+/)) {
    scrapeProposalDetail();
  } else if (url.includes("/nx/proposals") || url.includes("/ab/proposals")) {
    scrapeProposals();
  } else if (url.includes("/nx/find-work") || url.includes("/search/jobs") || url.includes("/ab/find-work")) {
    scrapeFeed();
    // Also check if a job detail panel is open on the feed page
    if (isJobPanelOpen()) {
      const jobUrl = findJobUrl(findJobContainer());
      if (jobUrl && !scrapedJobUrls.has(jobUrl)) {
        scrapedJobUrls.add(jobUrl);
        scrapeJob();
      }
    }
  }
}

// ── Watch for job panel opening on feed page (clicking a job card) ──
let panelObserverStarted = false;
function watchForJobPanel() {
  if (panelObserverStarted) return;
  panelObserverStarted = true;

  // Watch for DOM changes that indicate a job panel opened
  const observer = new MutationObserver(() => {
    if (isJobPanelOpen()) {
      const jobUrl = findJobUrl(findJobContainer());
      if (jobUrl && !scrapedJobUrls.has(jobUrl)) {
        console.log("[UT] Job panel detected, scraping:", jobUrl);
        scrapedJobUrls.add(jobUrl);
        // Delay to let panel content fully load
        setTimeout(() => scrapeJob(), 2000);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// ── Watch for filter changes on stats page ──
let statsObserverStarted = false;
let statsDebounceTimer = null;
function watchForStatsChanges() {
  if (statsObserverStarted) return;
  statsObserverStarted = true;
  console.log("[UT] Watching stats page for filter changes...");

  // Track the page text to detect when numbers change
  let lastStatsText = document.body.innerText.slice(0, 2000);

  const observer = new MutationObserver(() => {
    const currentText = document.body.innerText.slice(0, 2000);
    if (currentText !== lastStatsText) {
      lastStatsText = currentText;
      // Debounce — wait for changes to settle before re-scraping
      clearTimeout(statsDebounceTimer);
      statsDebounceTimer = setTimeout(() => {
        console.log("[UT] Stats page content changed, re-scraping...");
        scrapeStats();
      }, 2000);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// ── Watch for pagination changes on proposals page ──
let proposalObserverStarted = false;
let proposalDebounceTimer = null;
let lastProposalPageText = "";
function watchForProposalPageChanges() {
  if (proposalObserverStarted) return;
  proposalObserverStarted = true;
  console.log("[UT] Watching proposals page for pagination changes...");

  lastProposalPageText = document.body.innerText.slice(0, 2000);

  const observer = new MutationObserver(() => {
    const currentText = document.body.innerText.slice(0, 2000);
    if (currentText !== lastProposalPageText) {
      lastProposalPageText = currentText;
      clearTimeout(proposalDebounceTimer);
      proposalDebounceTimer = setTimeout(() => {
        console.log("[UT] Proposals page content changed, re-scraping...");
        scrapeProposals();
      }, 2000);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// ── Watch for new messages on messages page ──
let messageObserverStarted = false;
let messageDebounceTimer = null;
let lastMessagePageText = "";
function watchForNewMessages() {
  if (messageObserverStarted) return;
  messageObserverStarted = true;
  console.log("[UT] Watching messages page for new messages...");

  lastMessagePageText = document.body.innerText.slice(0, 3000);

  const observer = new MutationObserver(() => {
    const currentText = document.body.innerText.slice(0, 3000);
    if (currentText !== lastMessagePageText) {
      lastMessagePageText = currentText;
      clearTimeout(messageDebounceTimer);
      messageDebounceTimer = setTimeout(() => {
        console.log("[UT] Messages page content changed, re-scraping...");
        scrapeMessages();
      }, 2000);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// ── Run with delay for DOM to settle ──
function runWithDelay(delayMs = 3000) {
  setTimeout(() => {
    detectPageAndScrape();
    // Start watching for job panel clicks on feed pages
    const url = window.location.href;
    if (url.includes("/nx/find-work") || url.includes("/search/jobs") || url.includes("/ab/find-work")) {
      watchForJobPanel();
    }
    if (url.includes("/nx/my-stats") || url.includes("/my-stats")) {
      watchForStatsChanges();
    }
    if (url.includes("/nx/proposals") && !url.match(/\/nx\/proposals\/\d+/)) {
      watchForProposalPageChanges();
    }
    if (url.includes("/nx/messages") || url.includes("/ab/messages")) {
      watchForNewMessages();
    }
  }, delayMs);
}

function maybeWatchApplyPage(url) {
  if (url.match(/\/proposals\/job\/~[^/]+\/apply/)) {
    watchApplyPage();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    maybeWatchApplyPage(window.location.href);
    runWithDelay();
  });
} else {
  maybeWatchApplyPage(window.location.href);
  runWithDelay();
}

// ── Detect SPA navigation ──
let lastUrl = window.location.href;
const navObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    console.log("[UT] SPA navigation:", window.location.href);
    lastUrl = window.location.href;
    maybeWatchApplyPage(window.location.href);
    runWithDelay(2000);
  }
});
if (document.body) {
  navObserver.observe(document.body, { childList: true, subtree: true });
}

window.addEventListener("popstate", () => {
  setTimeout(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      maybeWatchApplyPage(window.location.href);
      runWithDelay(1500);
    }
  }, 1000);
});

console.log("[UT] Content script ready — active scraping enabled");

// ── Coverage modal ──
function showCoverageModal({ pct, unvisited }) {
  document.getElementById("ut-coverage-modal")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "ut-coverage-modal";
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    z-index: 2147483647; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;

  const pages = unvisited.map((p) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#fef3f2;border:1px solid #fecaca;border-radius:10px;">
      <span style="font-size:14px;color:#111827;font-weight:500;">${p.name}</span>
      <a href="${p.url}" target="_blank" rel="noopener noreferrer"
         style="font-size:12px;font-weight:600;color:#fff;background:#14b8a6;padding:5px 12px;border-radius:6px;text-decoration:none;">
        Open
      </a>
    </div>
  `).join("");

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;box-shadow:0 25px 50px rgba(0,0,0,0.25);max-width:420px;width:90%;padding:24px;">
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;">
        <div style="width:40px;height:40px;border-radius:50%;background:#fef2f2;border:1px solid #fecaca;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div>
          <div style="font-size:16px;font-weight:700;color:#111827;">Page coverage is ${pct}%</div>
          <div style="font-size:13px;color:#6b7280;margin-top:2px;">Open the pages below to keep your stats accurate.</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">${pages || '<p style="font-size:13px;color:#6b7280;text-align:center;">All required pages visited.</p>'}</div>
      <button id="ut-coverage-close" style="width:100%;padding:10px;background:#111827;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;">
        Close
      </button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.getElementById("ut-coverage-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SHOW_COVERAGE_MODAL") {
    showCoverageModal(message.payload);
  }
  if (message.type === "ACCOUNT_DISABLE_STATUS") {
    if (message.isDisabled) showDisabledBanner(message.reason);
    else removeDisabledBanner();
  }
});

// On page load, check stored disable status immediately
chrome.storage.local.get(["accountDisabled", "accountDisabledReason"], (data) => {
  if (data.accountDisabled) showDisabledBanner(data.accountDisabledReason ?? null);
});

function showDisabledBanner(reason) {
  removeDisabledBanner();
  const banner = document.createElement("div");
  banner.id = "__ut_disabled_banner";
  banner.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "z-index:2147483647",
    "background:rgba(220,38,38,0.82)",
    "backdrop-filter:blur(6px)",
    "-webkit-backdrop-filter:blur(6px)",
    "color:#fff",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "font-size:14px",
    "font-weight:600",
    "text-align:center",
    "padding:10px 48px",
    "box-shadow:0 2px 8px rgba(0,0,0,0.3)",
    "letter-spacing:0.01em",
  ].join(";");
  const msg = reason
    ? `Bidding disabled: ${reason}`
    : "Admin has forbidden bidding on this Upwork account";
  banner.textContent = msg;

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = [
    "position:absolute",
    "right:14px",
    "top:50%",
    "transform:translateY(-50%)",
    "background:rgba(255,255,255,0.2)",
    "border:none",
    "color:#fff",
    "font-size:13px",
    "font-weight:700",
    "width:24px",
    "height:24px",
    "border-radius:50%",
    "cursor:pointer",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "line-height:1",
    "padding:0",
  ].join(";");
  closeBtn.addEventListener("click", () => removeDisabledBanner());
  banner.appendChild(closeBtn);

  document.documentElement.appendChild(banner);
}

function removeDisabledBanner() {
  const existing = document.getElementById("__ut_disabled_banner");
  if (existing) existing.remove();
}
