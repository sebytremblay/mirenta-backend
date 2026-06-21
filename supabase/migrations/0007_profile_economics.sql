-- Add per-customer value-model economics to the product profile (Concern #1,
-- Phase 2). The vertical's value model bakes pricing and effectiveness into its
-- compute via a factory; Phase 1 always uses code defaults. This column lets two
-- customers share one vertical with different product economics.
--
-- The column is nullable: a null falls back to the vertical's defaultEconomics(),
-- so existing rows and any insert that omits economics keep the Phase 1 behavior.
-- The factory validates the JSON shape (src/verticals/employee-service.ts
-- validateEconomics) before compute reads it, so a malformed object fails the
-- build stage permanently rather than rendering wrong figures.
--
-- Shape:
--   {
--     "annual_license": number,
--     "implementation_fee": number,
--     "scenarios": [{ "name": string, "effectiveness": { "<key>": number } }],
--     "adoption_curve": [number]   -- optional
--   }

alter table product_profiles
  add column if not exists economics jsonb;

comment on column product_profiles.economics is
  'Per-customer value model economics. Null falls back to the vertical default. Shape: {annual_license, implementation_fee, scenarios:[{name, effectiveness:{key:number}}], adoption_curve?:[number]}.';
