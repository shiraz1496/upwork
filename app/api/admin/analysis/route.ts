import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { requireAdmin, adminErrorResponse } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return Response.json({ error: "prompt required" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    return Response.json({ text });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
