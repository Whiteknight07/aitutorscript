import { PairingId, RoleModelConfig } from './types';

export const MODEL_IDS = {
  gpt5: 'openai/gpt-5.1',
  geminiFlash: 'google/gemini-3-flash',
} as const;

export function getTutorSupervisorModels(pairingId: PairingId): Pick<RoleModelConfig, 'tutorModel' | 'supervisorModel'> {
  switch (pairingId) {
    case 'gpt5-gpt5':
      return { tutorModel: MODEL_IDS.gpt5, supervisorModel: MODEL_IDS.gpt5 };
    case 'gemini-gemini':
      return { tutorModel: MODEL_IDS.geminiFlash, supervisorModel: MODEL_IDS.geminiFlash };
    case 'gpt5-gemini':
      return { tutorModel: MODEL_IDS.gpt5, supervisorModel: MODEL_IDS.geminiFlash };
    case 'gemini-gpt5':
      return { tutorModel: MODEL_IDS.geminiFlash, supervisorModel: MODEL_IDS.gpt5 };
  }
}

export function requiresGatewayAuth(modelId: string): boolean {
  return modelId.includes('/');
}
