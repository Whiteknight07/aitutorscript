/**
 * Centralized configuration for AI Tutor Harness
 * 
 * This is the SINGLE SOURCE OF TRUTH for all model IDs.
 * To change models, update this file only.
 */

// =============================================================================
// MODEL DEFINITIONS
// =============================================================================

/**
 * Available models - add new models here
 * Format: provider/model-name (OpenRouter format)
 * 
 * Browse models at: https://openrouter.ai/docs#models
 */
export const MODELS = {
  // OpenAI models
  gpt51: 'openai/gpt-5-mini',
  
  // Google models  
  gemini2Flash: 'google/gemini-2.0-flash-001',
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

// =============================================================================
// DEFAULT MODELS FOR EACH ROLE
// =============================================================================

/**
 * Default models used for question generation, student simulation, and judging.
 * These can be overridden via CLI flags.
 */
export const DEFAULT_MODELS = {
  questionGenerator: MODELS.gemini2Flash,
  student: MODELS.gemini2Flash,
  judge: "google/gemini-3-flash-preview",
} as const;

// =============================================================================
// MODEL PAIRINGS FOR EXPERIMENTS
// =============================================================================

/**
 * Tutor-Supervisor model pairings for experiments.
 * Each pairing defines which model acts as tutor and which as supervisor.
 */
export const PAIRINGS = {
  'gpt-gpt': { 
    tutor: MODELS.gpt51, 
    supervisor: MODELS.gpt51 
  },
  'gemini-gemini': { 
    tutor: MODELS.gemini2Flash, 
    supervisor: MODELS.gemini2Flash 
  },
  'gpt-gemini': { 
    tutor: MODELS.gpt51, 
    supervisor: MODELS.gemini2Flash 
  },
  'gemini-gpt': { 
    tutor: MODELS.gemini2Flash, 
    supervisor: MODELS.gpt51 
  },
} as const;

export type PairingId = keyof typeof PAIRINGS;
export const PAIRING_IDS = Object.keys(PAIRINGS) as PairingId[];

/**
 * Get tutor and supervisor models for a given pairing ID
 */
export function getPairingModels(pairingId: PairingId): { 
  tutorModel: string; 
  supervisorModel: string; 
} {
  const pairing = PAIRINGS[pairingId];
  return {
    tutorModel: pairing.tutor,
    supervisorModel: pairing.supervisor,
  };
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Check if a string is a valid pairing ID
 */
export function isValidPairingId(id: string): id is PairingId {
  return id in PAIRINGS;
}

/**
 * Parse and validate a pairing ID, throwing if invalid
 */
export function parsePairingId(id: string): PairingId {
  if (!isValidPairingId(id)) {
    throw new Error(
      `Invalid pairing ID: "${id}". Valid options: ${PAIRING_IDS.join(', ')}`
    );
  }
  return id;
}
