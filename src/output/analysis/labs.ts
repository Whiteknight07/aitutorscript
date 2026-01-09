import { getSupervisorModel, getTutorModel, isValidSupervisorId, isValidTutorId } from '../../config';

export type LabPairType = 'same-lab' | 'cross-lab' | null;

export function labFromModelId(modelId: string): string {
  const provider = String(modelId).split('/')[0]?.toLowerCase();
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'google') return 'Google';
  if (provider === 'anthropic') return 'Anthropic';
  if (provider === 'meta') return 'Meta';
  if (!provider) return 'Unknown';
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function tutorLabFromId(tutorId: string): string | null {
  if (!tutorId) return null;
  if (isValidTutorId(tutorId)) {
    return labFromModelId(getTutorModel(tutorId));
  }
  return null;
}

export function supervisorLabFromId(supervisorId: string | null): string | null {
  if (!supervisorId) return null;
  if (isValidSupervisorId(supervisorId)) {
    return labFromModelId(getSupervisorModel(supervisorId));
  }
  return null;
}

export function labPairType(tutorLab: string | null, supervisorLab: string | null): LabPairType {
  if (!tutorLab || !supervisorLab) return null;
  return tutorLab === supervisorLab ? 'same-lab' : 'cross-lab';
}
