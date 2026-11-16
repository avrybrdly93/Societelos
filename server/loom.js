'use strict';

// Societelos — The Loom.
// The single module that talks to the Gemini API. Every call has an 8-second
// timeout and an offline fallback, so the game never waits on (or breaks
// because of) the network. The Loom never sets scores or game state: it only
// returns text and clamped effect vectors for the engine to use.

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

module.exports = { narrate, moderate, narrateResolution, moderateAndScorePolicies };
