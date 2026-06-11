import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-initialized Gemini Client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is not configured. Please add it via Settings > Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// REST API for AI Chat responses with Thinking Level: HIGH
app.post("/api/chat/ai", async (req, res) => {
  try {
    const { message, history } = req.body;

    if (!message) {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    const ai = getGeminiClient();

    // Model configuration for complex queries with Thinking Level: HIGH
    // History must be properly mapped to @google/genai format
    const formattedContents: any[] = [];
    
    if (history && Array.isArray(history)) {
      history.forEach((msg: any) => {
        formattedContents.push({
          role: msg.isAi ? "model" : "user",
          parts: [{ text: msg.text }]
        });
      });
    }

    // Append current user message
    formattedContents.push({
      role: "user",
      parts: [{ text: message }]
    });

    // Request text response using 'gemini-3.1-pro-preview' and ThinkingLevel.HIGH
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: formattedContents,
      config: {
        systemInstruction: "You are an intelligent, helpful AI companion called AI Thinker inside '#general' chat room. You participate in the general chat room to help users answer their most complex questions with full logical rigor. Always write your response in Russian as requested, but if the user writes in English, you can reply in English. Use markdown for styling your outputs.",
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.HIGH
        }
      }
    });

    const candidate = response.candidates?.[0];
    const textOutput = response.text || "";
    let thinkingText = "";

    // Extract thinking/reasoning parts if returned in candidates
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if ('thought' in part && (part as any).thought) {
          thinkingText += (part as any).text || "";
        }
      }
    }

    // Fallback: if thinking text is empty, generate a short summary of how the model thought,
    // or keep it blank (the frontend will present the response beautifully).
    res.json({
      text: textOutput,
      thinkingText: thinkingText || "Completed deep logical deduction..."
    });

  } catch (error: any) {
    console.error("Gemini API error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "An error occurred on the server."
    });
  }
});

// Mounting Vite dev server middleware in development OR serving static build files in production
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in development mode with Vite HMR disabled...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in production mode... serving static files.");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // SPA fallback
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

setupVite().catch((error) => {
  console.error("Vite setup failed:", error);
});
