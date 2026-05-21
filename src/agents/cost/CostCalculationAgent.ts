import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import { THRESHOLDS } from '@/config/thresholds';
import { makeResult, persistAgentResult } from '@/agents/baseAgent';
import type { AgentResult } from '@/types/agent';
import type { CostBundle } from '@/types/validation';

export interface CostInput {
  ottoProductId: string;
  amazonPrice: number;
  runId?: string;
}

export class CostCalculationAgent {
  readonly name = 'CostCalculationAgent';
  private readonly log = logger.child(this.name);

  async run(input: CostInput): Promise<AgentResult<CostBundle>> {
    const price = Math.max(0, input.amazonPrice || 0);
    const salesTax = +(price * (THRESHOLDS.SALES_TAX_ASSUMPTION_PCT / 100)).toFixed(2);
    const walletFee = +(price * (THRESHOLDS.AUTODS_WALLET_FEE_PCT / 100)).toFixed(2);
    const orderFee = THRESHOLDS.AUTODS_ORDER_FEE_FLAT;
    const returnReserve = +(price * (THRESHOLDS.RETURN_RESERVE_PCT / 100)).toFixed(2);
    const totalCostEstimate = +(price + salesTax + walletFee + orderFee + returnReserve).toFixed(2);

    const bundle: CostBundle = {
      amazonPrice: price,
      salesTaxAssumption: salesTax,
      autodsWalletFee: walletFee,
      autodsOrderFee: orderFee,
      returnReserve,
      totalCostEstimate,
    };

    try {
      await getSupabase().from('cost_calculations').insert({
        otto_product_id: input.ottoProductId,
        amazon_price: price,
        sales_tax_assumption: salesTax,
        autods_wallet_fee: walletFee,
        autods_order_fee: orderFee,
        return_reserve: returnReserve,
        total_cost_estimate: totalCostEstimate,
        predicted_monthly_profit_per_100_listings: null,
      });
    } catch (err) {
      this.log.warn('cost_calculations insert failed', { err: (err as Error).message });
    }

    const result = makeResult(
      this.name,
      input.ottoProductId,
      'pass',
      0,
      [`totalCostEstimate=${totalCostEstimate}`],
      bundle,
    );
    await persistAgentResult(result, input.runId);
    return result;
  }
}
