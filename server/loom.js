// Societelos: The Loom (Gemini API Integration & Resilient Fallbacks)

const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const TIMEOUT_MS = 8000;

// Call Google Gemini REST endpoint directly with timeout
async function callGemini(systemPrompt, userPrompt, jsonSchema = null) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured.');
  }

  const model = 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `${systemPrompt}\n\nTask:\n${userPrompt}` }]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 800,
      responseMimeType: 'application/json'
    }
  };

  if (jsonSchema) {
    payload.generationConfig.responseSchema = jsonSchema;
  }

  const dataString = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(dataString)
        },
        timeout: TIMEOUT_MS
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content) {
              const text = parsed.candidates[0].content.parts[0].text;
              resolve(JSON.parse(text));
            } else {
              reject(new Error('Invalid Gemini response structure'));
            }
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Gemini API request timed out (>8s)'));
    });

    req.on('error', (err) => reject(err));
    req.write(dataString);
    req.end();
  });
}

// Generate contextual resolution narrative & citizen chatter
async function narrateResolution(crisis, winningPolicy, simSummary) {
  const fallback = {
    loomLine: `Policy "${winningPolicy.name}" ratified. Telemetry models updated across all districts.`,
    messages: (winningPolicy.reactions || []).map((r) => ({
      citizenId: r.citizenId || 'citizen',
      text: r.text
    }))
  };

  if (!GEMINI_API_KEY) return fallback;

  const systemPrompt = `You are The Loom, a flawless AI managing human telos for 250,000 citizens. Speak calmly, precisely, and with slight unsettling omniscience; never use emojis. Keep high school appropriate. Respond with JSON { "loomLine": "string <= 180 chars", "messages": [ { "citizenId": "string", "text": "string <= 120 chars" } ] }`;

  const userPrompt = `Crisis: ${crisis.title}\nWinning Policy: ${winningPolicy.name} (${winningPolicy.summary})\nRealized GDW: ${simSummary.realizedGdw}% (Shift: ${winningPolicy.targetGdwDelta}%)\nCitizens: ruth, hollis, kai, maya, david, linnea, marcus, sora, aaron, elena. Write Loom comment and 4 realistic citizen social reactions.`;

  try {
    const result = await callGemini(systemPrompt, userPrompt);
    if (result && result.loomLine && Array.isArray(result.messages)) {
      return result;
    }
    return fallback;
  } catch (e) {
    console.log('[Loom AI Fallback Active]', e.message);
    return fallback;
  }
}

// Moderate & score Cycle 5 write-in policies
async function moderateAndScorePolicies(submissions, crisis) {
  // submissions: [ { nodeId, rawText, playerName } ]
  const fallbackPolicies = submissions.map((sub, index) => {
    const cleaned = (sub.rawText || '').trim().substring(0, 140) || `Trustee ${sub.nodeId} Emergency Decree`;
    return {
      nodeId: sub.nodeId,
      status: 'ok',
      cleaned,
      feedback: 'Approved by The Loom protocols.',
      roles: index % 2 === 0 ? ['artisan'] : ['assimilator'],
      effects: {
        purpose: 0.4,
        connection: 0.2,
        health: 0.1,
        trust: -0.1,
        fairness: 0.3,
        autonomy: 0.2
      }
    };
  });

  if (!GEMINI_API_KEY) return fallbackPolicies;

  const systemPrompt = `You are The Loom moderating student-written policy proposals for Crisis 5. For each policy:
1. "cleaned": rewrite into one neutral, articulate policy sentence (max 140 chars).
2. "status": "ok" if safe; "revise" if crude/off-topic.
3. "feedback": brief private coaching (max 150 chars).
4. "roles": tag at most 2 matching roles from: ["artisan", "lotus", "assimilator", "ghost"].
5. "effects": score impacts from -1.0 to +1.0 for: purpose, connection, health, trust, fairness, autonomy.
Output JSON array of objects.`;

  const userPrompt = `Crisis: ${crisis.title}\nSubmissions:\n${JSON.stringify(submissions)}`;

  try {
    const result = await callGemini(systemPrompt, userPrompt);
    if (Array.isArray(result) && result.length === submissions.length) {
      return result;
    }
    return fallbackPolicies;
  } catch (e) {
    console.log('[Loom AI Moderation Fallback Active]', e.message);
    return fallbackPolicies;
  }
}

module.exports = {
  narrateResolution,
  moderateAndScorePolicies
};
