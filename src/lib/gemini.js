const GEMINI_API_KEY = String(import.meta.env.VITE_GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = String(import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 25000;
const GEMINI_DEFAULT_GENERATION_CONFIG = {
  temperature: 0.7,
  topP: 0.9,
  maxOutputTokens: 700,
};

const buildGeminiUrl = (model = GEMINI_MODEL) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

const extractGeminiText = (payload = {}) => {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const textParts = candidates.flatMap((candidate) => {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    return parts
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean);
  });
  return textParts.join('\n').trim();
};

const readGeminiErrorMessage = async (response) => {
  try {
    const payload = await response.json();
    const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
    const detailMessage = details
      .map((entry) => entry?.reason || entry?.message || '')
      .find(Boolean);
    return payload?.error?.message || detailMessage || `Gemini request failed with ${response.status}.`;
  } catch {
    return `Gemini request failed with ${response.status}.`;
  }
};

const withTimeoutSignal = (timeoutMs = GEMINI_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(new Error('Gemini request timed out.')), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => window.clearTimeout(timeoutId),
  };
};

export const geminiConfig = {
  model: GEMINI_MODEL,
};

export const geminiIsConfigured = Boolean(GEMINI_API_KEY && GEMINI_MODEL);

const requestGeminiText = async ({
  systemInstruction = '',
  contents = [],
  generationConfig = {},
  timeoutMs = GEMINI_TIMEOUT_MS,
} = {}) => {
  if (!geminiIsConfigured) {
    throw new Error('Gemini is not configured.');
  }

  const { signal, clear } = withTimeoutSignal(timeoutMs);

  try {
    const response = await fetch(buildGeminiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      signal,
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: String(systemInstruction || '').trim() }],
        },
        contents,
        generationConfig: {
          ...GEMINI_DEFAULT_GENERATION_CONFIG,
          ...(generationConfig || {}),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(await readGeminiErrorMessage(response));
    }

    const payload = await response.json();
    const text = extractGeminiText(payload);
    if (!text) {
      throw new Error('Gemini returned an empty response.');
    }

    return {
      text,
      model: GEMINI_MODEL,
      raw: payload,
    };
  } finally {
    clear();
  }
};

const extractGeminiJsonString = (value = '') => {
  const text = String(value || '').trim();
  if (!text) return '';
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return text;
};

const parseGeminiJsonPayload = (value = '') => {
  const jsonText = extractGeminiJsonString(value);
  if (!jsonText) throw new Error('Gemini did not return JSON.');
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Gemini returned invalid JSON: ${error?.message || error}`);
  }
};

export const generateGeminiRelationshipReply = async ({
  prompt = '',
  systemInstruction = '',
  memoryContext = '',
  conversationTurns = [],
} = {}) => {
  const contents = [];

  if (memoryContext) {
    contents.push({
      role: 'user',
      parts: [{ text: `Relationship memory context:\n${memoryContext}` }],
    });
    contents.push({
      role: 'model',
      parts: [{ text: 'Memory received. I will answer using this saved relationship history and clearly label inferences.' }],
    });
  }

  (conversationTurns || []).forEach((turn) => {
    const text = String(turn?.text || '').trim();
    if (!text) return;
    contents.push({
      role: turn?.role === 'assistant' ? 'model' : 'user',
      parts: [{ text }],
    });
  });

  contents.push({
    role: 'user',
    parts: [{ text: String(prompt || '').trim() }],
  });

  return requestGeminiText({
    systemInstruction,
    contents,
  });
};

export const generateGeminiDiaryWriteup = async ({
  sourceType = 'game',
  promptVersion = '',
  facts = {},
  systemInstruction = '',
} = {}) => {
  const reservedHeadlineLines = Array.isArray(facts?.existingChapterTitles) && facts.existingChapterTitles.length
    ? `\n\nHeadlines already used in this diary book (your JSON headline must not match any of these, case-insensitive):\n${facts.existingChapterTitles
      .map((entry) => `- ${String(entry || '').trim()}`)
      .filter((line) => line.length > 2)
      .join('\n')}`
    : '';
  const prompt = [
    'Return strict JSON only.',
    'Use this schema exactly:',
    '{"headline":"Short varied chapter title (about 2-6 words)","summary":"One-sentence summary","writeup":"Diary prose with 2-4 short paragraphs"}',
    `Source type: ${String(sourceType || 'game').trim() || 'game'}`,
    `Prompt version: ${String(promptVersion || '').trim() || 'unspecified'}`,
    'Make the headline feel distinct to this specific chapter. Avoid repeating the same title structure from one chapter to the next.',
    'Write the writeup like a warm relationship story with a beginning, middle, and ending. Avoid a mechanical recap.',
    'If Facts JSON contains gameChat.highlights, weave in 1-3 shared chat details as personal color, with speakers named and only short quoted snippets.',
    'Use answers, score turns, chat, feedback, replay requests, and AMA story details to make it feel personal to Jay and Kim without inventing anything.',
    `Facts JSON:\n${JSON.stringify(facts || {}, null, 2)}${reservedHeadlineLines}`,
  ].join('\n\n');

  const result = await requestGeminiText({
    systemInstruction,
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      maxOutputTokens: 1100,
    },
  });

  const payload = parseGeminiJsonPayload(result.text);
  const headline = String(payload?.headline || '').trim();
  const summary = String(payload?.summary || '').trim();
  const writeup = String(payload?.writeup || '').trim();
  if (!headline || !summary || !writeup) {
    throw new Error('Gemini diary response was missing headline, summary, or writeup.');
  }

  return {
    headline,
    summary,
    writeup,
    model: result.model || GEMINI_MODEL,
    raw: result.raw,
    text: result.text,
  };
};

export const generateGeminiQuestionBankCsv = async ({
  prompt = '',
  repairReport = '',
  previousCsv = '',
  targetName = 'Question Bank',
  questionCount = 50,
} = {}) => {
  const requestedCount = Math.max(1, Math.min(50, Number.parseInt(questionCount, 10) || 50));
  const isRepair = Boolean(String(repairReport || '').trim() || String(previousCsv || '').trim());
  const userPrompt = [
    String(prompt || '').trim(),
    isRepair ? 'Repair request from the KJK app checker:' : '',
    isRepair ? String(repairReport || '').trim() : '',
    isRepair ? 'Previous CSV that failed the checker:' : '',
    isRepair ? String(previousCsv || '').trim() : '',
    isRepair
      ? `Return the full corrected CSV for ${targetName}. Do not explain the repair.`
      : `Return the full CSV for ${targetName}.`,
  ].filter(Boolean).join('\n\n');

  return requestGeminiText({
    systemInstruction: [
      'You generate strict CSV files for the KJK app question bank.',
      'Return raw CSV text only: no markdown fences, no commentary, no surrounding explanation.',
      'The first line must be the requested header, followed by exactly the requested number of data rows.',
      'Do not return a sample, preview, or shortened response.',
    ].join('\n'),
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: isRepair ? 0.35 : 0.82,
      topP: 0.95,
      maxOutputTokens: Math.min(24000, Math.max(7000, requestedCount * 340)),
    },
    timeoutMs: 90000,
  });
};
