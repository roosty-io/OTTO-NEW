export type AgentStatus = 'pass' | 'fail' | 'warning' | 'manual_review';

export interface AgentResult<T extends object = Record<string, unknown>> {
  agentName: string;
  productId: string;
  status: AgentStatus;
  score: number;
  reasons: string[];
  data: T;
  createdAt: string;
}

export interface AgentVote {
  agentName: string;
  productId: string;
  vote: 'approve' | 'reject' | 'review';
  weight: number;
  reason: string;
}

export interface AgentMessage {
  fromAgent: string;
  toAgent: string;
  productId: string;
  payload: Record<string, unknown>;
}

export interface AgentLogEntry {
  agentName: string;
  productId?: string;
  runId?: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

export interface BaseAgent<TInput, TOutput extends object = Record<string, unknown>> {
  name: string;
  run(input: TInput): Promise<AgentResult<TOutput>>;
}
