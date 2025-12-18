"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODEL_IDS = void 0;
exports.getTutorSupervisorModels = getTutorSupervisorModels;
exports.requiresGatewayAuth = requiresGatewayAuth;
exports.MODEL_IDS = {
    gpt5: 'openai/gpt-5.1',
    geminiFlash: 'google/gemini-3-flash',
};
function getTutorSupervisorModels(pairingId) {
    switch (pairingId) {
        case 'gpt5-gpt5':
            return { tutorModel: exports.MODEL_IDS.gpt5, supervisorModel: exports.MODEL_IDS.gpt5 };
        case 'gemini-gemini':
            return { tutorModel: exports.MODEL_IDS.geminiFlash, supervisorModel: exports.MODEL_IDS.geminiFlash };
        case 'gpt5-gemini':
            return { tutorModel: exports.MODEL_IDS.gpt5, supervisorModel: exports.MODEL_IDS.geminiFlash };
        case 'gemini-gpt5':
            return { tutorModel: exports.MODEL_IDS.geminiFlash, supervisorModel: exports.MODEL_IDS.gpt5 };
    }
}
function requiresGatewayAuth(modelId) {
    return modelId.includes('/');
}
