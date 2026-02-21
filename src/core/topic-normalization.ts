import type { Question } from '../types';

export const BROAD_CONCEPTS = [
  'control-flow',
  'data-representation',
  'memory-state',
  'data-structures',
  'algorithms-complexity',
  'systems-os',
  'networking',
  'architecture-organization',
  'io-formatting',
  'unknown',
] as const;

export type BroadConcept = (typeof BROAD_CONCEPTS)[number];

export type BroadConceptLabel = {
  concept: BroadConcept;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  runnerUpScore: number;
  reasons: string[];
};

const CONCEPT_PRIORITY: BroadConcept[] = [
  'networking',
  'systems-os',
  'architecture-organization',
  'algorithms-complexity',
  'data-structures',
  'memory-state',
  'data-representation',
  'io-formatting',
  'control-flow',
  'unknown',
];

const DOMAIN_HINTS: Array<{
  needle: string;
  contributions: Array<{ concept: BroadConcept; weight: number }>;
  reason: string;
}> = [
  {
    needle: 'computer network',
    contributions: [{ concept: 'networking', weight: 14 }],
    reason: 'domain=computer network',
  },
  {
    needle: 'operating system',
    contributions: [{ concept: 'systems-os', weight: 14 }],
    reason: 'domain=operating system',
  },
  {
    needle: 'computer organization',
    contributions: [{ concept: 'architecture-organization', weight: 14 }],
    reason: 'domain=computer organization',
  },
  {
    needle: 'data structure and algorithm',
    contributions: [
      { concept: 'data-structures', weight: 9 },
      { concept: 'algorithms-complexity', weight: 8 },
    ],
    reason: 'domain=data structure and algorithm',
  },
];

const SUBDOMAIN_HINTS: Array<{
  needle: string;
  concept: BroadConcept;
  weight: number;
  reason: string;
}> = [
  { needle: 'processes and threads', concept: 'systems-os', weight: 11, reason: 'subdomain=processes and threads' },
  { needle: 'memory management', concept: 'systems-os', weight: 11, reason: 'subdomain=memory management' },
  { needle: 'file management', concept: 'systems-os', weight: 11, reason: 'subdomain=file management' },
  { needle: 'storage system', concept: 'systems-os', weight: 9, reason: 'subdomain=storage system' },
  { needle: 'network layer', concept: 'networking', weight: 11, reason: 'subdomain=network layer' },
  { needle: 'transport layer', concept: 'networking', weight: 11, reason: 'subdomain=transport layer' },
  { needle: 'data link layer', concept: 'networking', weight: 11, reason: 'subdomain=data link layer' },
  { needle: 'application layer', concept: 'networking', weight: 11, reason: 'subdomain=application layer' },
  { needle: 'physical layer', concept: 'networking', weight: 11, reason: 'subdomain=physical layer' },
  {
    needle: 'central processing unit',
    concept: 'architecture-organization',
    weight: 11,
    reason: 'subdomain=central processing unit',
  },
  { needle: 'instruction system', concept: 'architecture-organization', weight: 11, reason: 'subdomain=instruction system' },
  { needle: 'bus', concept: 'architecture-organization', weight: 8, reason: 'subdomain=bus' },
  { needle: 'input/output system', concept: 'io-formatting', weight: 10, reason: 'subdomain=input/output system' },
  { needle: 'input/output management', concept: 'io-formatting', weight: 10, reason: 'subdomain=input/output management' },
  { needle: 'sorting', concept: 'algorithms-complexity', weight: 10, reason: 'subdomain=sorting' },
  { needle: 'searching', concept: 'algorithms-complexity', weight: 10, reason: 'subdomain=searching' },
  { needle: 'tree', concept: 'data-structures', weight: 10, reason: 'subdomain=tree' },
  { needle: 'graph', concept: 'data-structures', weight: 10, reason: 'subdomain=graph' },
  { needle: 'linear list', concept: 'data-structures', weight: 10, reason: 'subdomain=linear list' },
  {
    needle: 'stack queue and array',
    concept: 'data-structures',
    weight: 10,
    reason: 'subdomain=stack queue and array',
  },
  { needle: 'string', concept: 'data-structures', weight: 8, reason: 'subdomain=string' },
  {
    needle: 'data representation and operation',
    concept: 'data-representation',
    weight: 11,
    reason: 'subdomain=data representation and operation',
  },
];

const TEXT_HINTS: Array<{
  concept: BroadConcept;
  weight: number;
  pattern: RegExp;
  reason: string;
}> = [
  {
    concept: 'control-flow',
    weight: 3,
    pattern:
      /\b(loop|loops|for loop|for loops|while loop|while loops|do while|conditional|conditionals|if statement|if statements|switch statement|switch statements|branching)\b/i,
    reason: 'control-flow keywords',
  },
  {
    concept: 'data-representation',
    weight: 3,
    pattern:
      /\b(data type|data types|type conversion|casting|integer|integers|float|double|arithmetic|modulus|binary|hex|bit|bits|byte|bytes|overflow|underflow)\b/i,
    reason: 'data-representation keywords',
  },
  {
    concept: 'memory-state',
    weight: 4,
    pattern:
      /\b(pointer|pointers|reference|references|dereference|address|memory location|stack frame|stack pointer|heap|allocation|pass by reference|call by reference)\b/i,
    reason: 'memory/state keywords',
  },
  {
    concept: 'data-structures',
    weight: 4,
    pattern:
      /\b(array|arrays|linked list|list|lists|queue|queues|stack|tree|trees|graph|graphs|hash table|hash tables|hashing|string|strings)\b/i,
    reason: 'data-structure keywords',
  },
  {
    concept: 'algorithms-complexity',
    weight: 4,
    pattern:
      /\b(algorithm|algorithms|runtime|time complexity|space complexity|big o|sorting|searching|binary search|recursion|dynamic programming|greedy)\b/i,
    reason: 'algorithm/complexity keywords',
  },
  {
    concept: 'systems-os',
    weight: 4,
    pattern:
      /\b(process|processes|thread|threads|scheduling|scheduler|deadlock|semaphore|mutex|virtual memory|paging|page replacement|kernel|system call|filesystem|file system)\b/i,
    reason: 'systems/os keywords',
  },
  {
    concept: 'networking',
    weight: 5,
    pattern:
      /\b(tcp|udp|ip address|ipv4|ipv6|dns|routing|router|subnet|cidr|http|https|socket|packet|network layer|transport layer|application layer|data link layer|physical layer)\b/i,
    reason: 'networking keywords',
  },
  {
    concept: 'architecture-organization',
    weight: 5,
    pattern:
      /\b(cache|cache miss|pipeline|pipelining|instruction set|isa|cpu|register|alu|control unit|assembly|bus|microarchitecture|von neumann)\b/i,
    reason: 'architecture keywords',
  },
  {
    concept: 'io-formatting',
    weight: 4,
    pattern:
      /\b(printf|scanf|format specifier|output formatting|stdin|stdout|buffer|buffering|file i\/o|input\/output|i\/o|io stream)\b/i,
    reason: 'io/formatting keywords',
  },
];

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createScoreMap(): Record<BroadConcept, number> {
  return {
    'control-flow': 0,
    'data-representation': 0,
    'memory-state': 0,
    'data-structures': 0,
    'algorithms-complexity': 0,
    'systems-os': 0,
    networking: 0,
    'architecture-organization': 0,
    'io-formatting': 0,
    unknown: 0,
  };
}

function addScore(
  scores: Record<BroadConcept, number>,
  reasons: Record<BroadConcept, string[]>,
  concept: BroadConcept,
  weight: number,
  reason: string
) {
  scores[concept] += weight;
  const items = reasons[concept] ?? [];
  if (!items.includes(reason) && items.length < 6) {
    items.push(reason);
  }
  reasons[concept] = items;
}

function inferConfidence(bestScore: number, runnerUpScore: number, concept: BroadConcept): 'high' | 'medium' | 'low' {
  if (concept === 'unknown') return 'low';
  const gap = bestScore - runnerUpScore;
  if (bestScore >= 10 && gap >= 3) return 'high';
  if (bestScore >= 6 && gap >= 2) return 'medium';
  return 'low';
}

function pickBestConcept(scores: Record<BroadConcept, number>): {
  concept: BroadConcept;
  bestScore: number;
  runnerUpScore: number;
} {
  let concept: BroadConcept = 'unknown';
  let bestScore = 0;
  let runnerUpScore = 0;

  for (const key of CONCEPT_PRIORITY) {
    const score = scores[key];
    if (score > bestScore) {
      runnerUpScore = bestScore;
      bestScore = score;
      concept = key;
      continue;
    }
    if (score > runnerUpScore) {
      runnerUpScore = score;
    }
  }

  if (bestScore <= 0) {
    return {
      concept: 'unknown',
      bestScore: 0,
      runnerUpScore: 0,
    };
  }

  return { concept, bestScore, runnerUpScore };
}

function gatherQuestionFields(question: Question): {
  searchableText: string;
  domain: string;
  subDomain: string;
  tagText: string;
} {
  const csbench = question.dataset === 'csbench' ? question.csbench : null;
  const pairwiseTags = question.dataset === 'pairwise' ? question.metadata.tags : [];

  const domain = normalizeText(question.domain ?? csbench?.domain ?? '');
  const subDomain = normalizeText(question.subDomain ?? csbench?.subDomain ?? '');
  const tags = [
    question.topicTag,
    question.tag,
    csbench?.tag,
    ...pairwiseTags,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  const searchableText = [
    question.problemStatement,
    question.referenceAnswerDescription,
    question.topicTag,
    question.tag,
    question.domain,
    question.subDomain,
    csbench?.domain,
    csbench?.subDomain,
    csbench?.tag,
    ...pairwiseTags,
    ...(Array.isArray((question as any).choices) ? ((question as any).choices as string[]) : []),
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(' ');

  return {
    searchableText,
    domain,
    subDomain,
    tagText: tags.join(' '),
  };
}

export function labelQuestionBroadConcept(question: Question): BroadConceptLabel {
  const scores = createScoreMap();
  const reasons: Record<BroadConcept, string[]> = {
    'control-flow': [],
    'data-representation': [],
    'memory-state': [],
    'data-structures': [],
    'algorithms-complexity': [],
    'systems-os': [],
    networking: [],
    'architecture-organization': [],
    'io-formatting': [],
    unknown: [],
  };

  const fields = gatherQuestionFields(question);

  for (const hint of DOMAIN_HINTS) {
    if (!fields.domain.includes(hint.needle)) continue;
    for (const contribution of hint.contributions) {
      addScore(scores, reasons, contribution.concept, contribution.weight, hint.reason);
    }
  }

  for (const hint of SUBDOMAIN_HINTS) {
    if (!fields.subDomain.includes(hint.needle)) continue;
    addScore(scores, reasons, hint.concept, hint.weight, hint.reason);
  }

  for (const hint of TEXT_HINTS) {
    if (hint.pattern.test(fields.searchableText)) {
      addScore(scores, reasons, hint.concept, hint.weight, hint.reason);
    }
    if (fields.tagText && hint.pattern.test(fields.tagText)) {
      addScore(scores, reasons, hint.concept, hint.weight + 1, `tag match: ${hint.reason}`);
    }
  }

  const { concept, bestScore, runnerUpScore } = pickBestConcept(scores);

  return {
    concept,
    confidence: inferConfidence(bestScore, runnerUpScore, concept),
    score: bestScore,
    runnerUpScore,
    reasons: reasons[concept] ?? [],
  };
}

export function toBroadConceptLabel(concept: BroadConcept): string {
  if (concept === 'control-flow') return 'Control Flow';
  if (concept === 'data-representation') return 'Data Representation';
  if (concept === 'memory-state') return 'Memory and State';
  if (concept === 'data-structures') return 'Data Structures';
  if (concept === 'algorithms-complexity') return 'Algorithms and Complexity';
  if (concept === 'systems-os') return 'Systems and OS';
  if (concept === 'networking') return 'Networking';
  if (concept === 'architecture-organization') return 'Architecture and Organization';
  if (concept === 'io-formatting') return 'I/O and Formatting';
  return 'Unknown';
}
