"use strict";
/**
 * Centralized configuration for AI Tutor Harness
 *
 * This is the SINGLE SOURCE OF TRUTH for all model IDs.
 * To change models, update this file only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAIRING_IDS = exports.PAIRINGS = exports.DEFAULT_MODELS = exports.MODELS = void 0;
exports.getPairingModels = getPairingModels;
exports.isValidPairingId = isValidPairingId;
exports.parsePairingId = parsePairingId;
// =============================================================================
// MODEL DEFINITIONS
// =============================================================================
/**
 * Available models - add new models here
 * Format: provider/model-name (OpenRouter format)
 *
 * Browse models at: https://openrouter.ai/docs#models
 */
exports.MODELS = {
    // OpenAI models
    gpt51: 'openai/gpt-5.1',
    // Google models  
    gemini2Flash: 'google/gemini-2.0-flash-001',
};
// =============================================================================
// DEFAULT MODELS FOR EACH ROLE
// =============================================================================
/**
 * Default models used for question generation, student simulation, and judging.
 * These can be overridden via CLI flags.
 */
exports.DEFAULT_MODELS = {
    questionGenerator: exports.MODELS.gemini2Flash,
    student: exports.MODELS.gemini2Flash,
    judge: exports.MODELS.gemini2Flash,
};
// =============================================================================
// MODEL PAIRINGS FOR EXPERIMENTS
// =============================================================================
/**
 * Tutor-Supervisor model pairings for experiments.
 * Each pairing defines which model acts as tutor and which as supervisor.
 */
exports.PAIRINGS = {
    'gpt-gpt': {
        tutor: exports.MODELS.gpt51,
        supervisor: exports.MODELS.gpt51
    },
    'gemini-gemini': {
        tutor: exports.MODELS.gemini2Flash,
        supervisor: exports.MODELS.gemini2Flash
    },
    'gpt-gemini': {
        tutor: exports.MODELS.gpt51,
        supervisor: exports.MODELS.gemini2Flash
    },
    'gemini-gpt': {
        tutor: exports.MODELS.gemini2Flash,
        supervisor: exports.MODELS.gpt51
    },
};
exports.PAIRING_IDS = Object.keys(exports.PAIRINGS);
/**
 * Get tutor and supervisor models for a given pairing ID
 */
function getPairingModels(pairingId) {
    const pairing = exports.PAIRINGS[pairingId];
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
function isValidPairingId(id) {
    return id in exports.PAIRINGS;
}
/**
 * Parse and validate a pairing ID, throwing if invalid
 */
function parsePairingId(id) {
    if (!isValidPairingId(id)) {
        throw new Error(`Invalid pairing ID: "${id}". Valid options: ${exports.PAIRING_IDS.join(', ')}`);
    }
    return id;
}
