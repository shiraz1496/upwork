import { NextResponse } from "next/server";

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

async function callGemini(model: string, apiKey: string, body: unknown): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || '';  
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY not configured on the server" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const {
      coverLetter,
      jobTitle,
      jobDescription,
      jobCategory,
      budget,
      experienceLevel,
      projectLength,
    } = body || {};

    if (!coverLetter || typeof coverLetter !== "string" || coverLetter.trim().length < 10) {
      return NextResponse.json(
        { error: "coverLetter is required (at least 10 characters)" },
        { status: 400 }
      );
    }
    if (!jobDescription || typeof jobDescription !== "string") {
      return NextResponse.json(
        { error: "jobDescription is required" },
        { status: 400 }
      );
    }

    const prompt = `You are a senior Upwork freelancer reviewing a cover letter before submission. Be honest and direct — flag real problems, do not sugarcoat. The freelancer wants to win this job, so weak writing must be called out.

Score the letter 0-100 by averaging these axes:
  1. RELEVANCE — directly addresses this job's requirements
  2. SPECIFICITY — concrete examples, links, numbers (not vague claims like "I have experience")
  3. TONE — confident, professional; not desperate, generic, or salesy
  4. STRUCTURE — clear opening hook, middle, close; readable paragraphs
  5. GRAMMAR — spelling, punctuation, sentence quality
  6. LENGTH — appropriate (typically 80-200 words for small jobs, 150-300 for larger ones)
  7. VALUE — clear "why hire me" / value proposition

For each issue, give: severity (critical|major|minor), category, the specific problem (quote the offending phrase if useful), and a concrete suggested fix.
Also list 1-3 genuine strengths if any exist (do NOT invent strengths to be polite).

JOB CONTEXT
Title: ${jobTitle || "(not provided)"}
Category: ${jobCategory || "(not provided)"}
Budget: ${budget || "(not provided)"}
Experience level: ${experienceLevel || "(not provided)"}
Project length: ${projectLength || "(not provided)"}

Description:
${jobDescription}

COVER LETTER
${coverLetter}`;

    const geminiBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            score: { type: "integer", description: "Overall score 0-100" },
            summary: { type: "string", description: "1-2 sentence overall assessment" },
            issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  severity: { type: "string", enum: ["critical", "major", "minor"] },
                  category: {
                    type: "string",
                    enum: ["relevance", "specificity", "tone", "structure", "grammar", "length", "value"],
                  },
                  message: { type: "string" },
                  fix: { type: "string" },
                },
                required: ["severity", "category", "message", "fix"],
              },
            },
            strengths: { type: "array", items: { type: "string" } },
          },
          required: ["score", "summary", "issues", "strengths"],
        },
      },
    };

    let res: Response | null = null;
    let lastErr = "";
    outer: for (const model of GEMINI_MODELS) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 1500));
        res = await callGemini(model, apiKey, geminiBody);
        if (res.ok) break outer;
        if (res.status !== 503 && res.status !== 429) {
          lastErr = `${model} ${res.status}: ${await res.text()}`;
          break outer;
        }
        lastErr = `${model} ${res.status}`;
        console.log("[analyze/cover-letter] retry:", lastErr, "attempt", attempt + 1);
      }
    }

    if (!res || !res.ok) {
      console.error("[analyze/cover-letter] all attempts failed:", lastErr.slice(0, 500));
      return NextResponse.json(
        { error: "All Gemini attempts failed (overloaded or rate-limited)", detail: lastErr.slice(0, 300) },
        { status: 502 }
      );
    }

    const geminiData = await res.json();
    const responseText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      return NextResponse.json(
        { error: "Empty response from Gemini" },
        { status: 502 }
      );
    }

    let analysis;
    try {
      analysis = JSON.parse(responseText);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse model response as JSON", raw: responseText.slice(0, 500) },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, analysis });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[analyze/cover-letter]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
