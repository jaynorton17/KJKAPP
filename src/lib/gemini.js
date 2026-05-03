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

const withTimeoutSignal = () => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(new Error('Gemini request timed out.')), GEMINI_TIMEOUT_MS);
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
} = {}) => {
  if (!geminiIsConfigured) {
    throw new Error('Gemini is not configured.');
  }

  const { signal, clear } = withTimeoutSignal();

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
  const prompt = [
    'Return strict JSON only.',
    'Use this schema exactly:',
    '{"headline":"Short chapter title","summary":"One-sentence summary","writeup":"Diary prose with 2-4 short paragraphs"}',
    `Source type: ${String(sourceType || 'game').trim() || 'game'}`,
    `Prompt version: ${String(promptVersion || '').trim() || 'unspecified'}`,
    `Facts JSON:\n${JSON.stringify(facts || {}, null, 2)}`,
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
      maxOutputTokens: 900,
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
