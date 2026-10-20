import { z } from 'zod';

// Configuration validation must not initialize the live provider SDK.
export const livePolicySchema=z.object({consent:z.literal(true),currency:z.literal('USD'),budget_usd:z.number().finite().positive(),verified_model:z.string().min(3).max(120),provider_slug:z.string().regex(/^[a-z0-9-]{1,80}$/),verified_at:z.string(),input_usd_per_million:z.number().finite().nonnegative(),output_usd_per_million:z.number().finite().nonnegative(),pricing_source:z.literal('https://ai-gateway.vercel.sh/v1/models')}).strict();
