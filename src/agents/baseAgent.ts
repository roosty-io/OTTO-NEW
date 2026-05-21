import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import type { AgentLogEntry, AgentResult, AgentVote } from '@/types/agent';

const supabase = () => getSupabase();

export async function persistAgentLog(entry: AgentLogEntry): Promise<void> {
  try {
    await supabase()
      .from('agent_logs')
      .insert({
        agent_name: entry.agentName,
        otto_product_id: entry.productId,
        discovery_run_id: entry.runId,
        level: entry.level,
        message: entry.message,
        data: entry.data ?? {},
      });
  } catch (err) {
    logger.warn('Failed to persist agent log', { err: (err as Error).message, agent: entry.agentName });
  }
}

export async function persistAgentResult<T extends object>(
  result: AgentResult<T>,
  runId?: string,
): Promise<void> {
  await persistAgentLog({
    agentName: result.agentName,
    productId: result.productId,
    runId,
    level: result.status === 'fail' ? 'warn' : 'info',
    message: `${result.agentName} ${result.status} (${result.score})`,
    data: { score: result.score, reasons: result.reasons, data: result.data },
  });
}

export async function persistAgentVote(vote: AgentVote): Promise<void> {
  try {
    await supabase()
      .from('agent_votes')
      .insert({
        agent_name: vote.agentName,
        otto_product_id: vote.productId,
        vote: vote.vote,
        weight: vote.weight,
        reason: vote.reason,
      });
  } catch (err) {
    logger.warn('Failed to persist agent vote', { err: (err as Error).message, agent: vote.agentName });
  }
}

export function makeResult<T extends object>(
  agentName: string,
  productId: string,
  status: AgentResult['status'],
  score: number,
  reasons: string[],
  data: T,
): AgentResult<T> {
  return {
    agentName,
    productId,
    status,
    score,
    reasons,
    data,
    createdAt: new Date().toISOString(),
  };
}

export async function recordRejection(
  ottoProductId: string,
  stage: string,
  reason: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase()
      .from('rejected_products')
      .insert({
        otto_product_id: ottoProductId,
        stage,
        reason,
        details: details ?? {},
      });
  } catch (err) {
    logger.warn('Failed to persist rejection', { err: (err as Error).message, stage, ottoProductId });
  }
}
