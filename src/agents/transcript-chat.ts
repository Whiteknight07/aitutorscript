import { TranscriptMessage } from '../types';

export type AgentChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type TranscriptPerspective = 'student' | 'tutor' | 'observer';

function mapRoleForPerspective(role: TranscriptMessage['role'], perspective: TranscriptPerspective): AgentChatMessage['role'] {
  if (perspective === 'student') {
    return role === 'student' ? 'assistant' : 'user';
  }

  return role === 'student' ? 'user' : 'assistant';
}

export function transcriptToChatMessages(
  transcript: TranscriptMessage[],
  perspective: TranscriptPerspective
): AgentChatMessage[] {
  return transcript.map((message) => ({
    role: mapRoleForPerspective(message.role, perspective),
    content: message.content,
  }));
}
