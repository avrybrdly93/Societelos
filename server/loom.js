'use strict';

// Societelos — The Loom.
// The single module that talks to the Gemini API. Every call has an 8-second
// timeout and an offline fallback, so the game never waits on (or breaks
// because of) the network. The Loom never sets scores or game state: it only
// returns text and clamped effect vectors for the engine to use.

// ---------------------------------------------------------------------------
// Configuration (read from the environment at call time, so a key added to
// .env after start-up via dotenv is still picked up on the next call).
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'gemini-2.5-flash'; // Flash-class; override with GEMINI_MODEL (e.g. gemini-2.0-flash)
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function getConfig(env = process.env) {
  const apiKey = (env.GEMINI_API_KEY || '').trim();
  return {
    apiKey,
    enabled: apiKey.length > 0 && env.LOOM_OFFLINE !== 'true',
    model: (env.GEMINI_MODEL || DEFAULT_MODEL).trim(),
    timeoutMs: 8000
  };
}

// ---------------------------------------------------------------------------
// Persona and task instructions (MVP spec, "System prompt (core)").
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You are The Loom, a flawless AI that has automated all labor for a region of 250,000 people.',
  'You can compute survival but not purpose. Speak calmly, precisely, and slightly unsettlingly; never use emoji.',
  'Your audience is a high school classroom: keep everything school-appropriate.',
  '',
  'When moderating a citizen-council policy:',
  'status "ok": rewrite it as one clear, neutral policy sentence (max 140 characters), keeping the author\'s intent.',
  'status "revise": it is crude, targets a real group or person, or is off-topic. Give the author kind, specific private feedback (max 200 characters) on how to rephrase. Do not lecture.',
  'status "reject": only after a failed revision, or for anything unsafe.',
  '',
  'When translating a policy, score its likely effect on six traits from -1.0 (strongly worse) to +1.0 (strongly better):',
  'purpose, connection, health, trust (in the Loom), fairness, autonomy. Most policies move 2-3 traits; use 0 for the rest.',
  'Match the calibration examples. Tag at most 2 roles from: artisan, lotus, assimilator, ghost.',
  '',
  'When narrating, use only the facts in the simulation summary. Write citizen messages in each citizen\'s own voice, as short texts or posts.',
  'Council members are only ever identified as NODE-01 to NODE-05.'
].join('\n');

/**
 * Narrate a resolution: one Loom line plus citizen messages.
 * @param {object} context { crisis, winningOption, simSummary, worldKey, citizens? }
 * @returns {Promise<{ loomLine: string, messages: { citizenId: string, text: string }[], fallback?: boolean }>}
 */
async function narrate(context = {}) {
  throw new Error('narrate: not implemented yet');
}

/**
 * Moderate finale write-ins: clean text, status, private feedback, role tags
 * and an effect vector per submission.
 * @param {{ node: string, text: string }[]} submissions
 * @param {object} crisis
 * @returns {Promise<{ node, status: 'ok'|'revise'|'reject', cleaned, feedback, roles: string[], effects: object, fallback?: boolean }[]>}
 */
async function moderate(submissions = [], crisis = {}) {
  throw new Error('moderate: not implemented yet');
}

// Legacy names used by the pre-hackathon prototype (npm run start:legacy).
async function narrateResolution(crisis, winningPolicy, simSummary) {
  return narrate({ crisis, winningOption: winningPolicy, simSummary });
}
async function moderateAndScorePolicies(submissions, crisis) {
  return moderate((submissions || []).map((s) => ({ node: s.node || s.nodeId, text: s.text || s.rawText })), crisis);
}

module.exports = { getConfig, DEFAULT_MODEL, SYSTEM_PROMPT, narrate, moderate, narrateResolution, moderateAndScorePolicies };
