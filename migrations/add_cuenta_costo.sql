-- =============================================================
-- Migración: costo de cada licencia (cuentas)
-- Correr en: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================
-- Con el costo y la fecha de compra, el panel (Ventas → Por cuenta y juego)
-- muestra cuánto se invirtió en cada cuenta, cuánto se cobró, la ganancia,
-- cuánto falta para recuperarla y en cuántos días se recuperó.
-- costo_usd: lo que costó la licencia en la PlayStation Store (en dólares,
--            sin impuestos: el panel le aplica el costo real por dólar).
-- fecha_compra: cuándo se compró (si falta, se usa la fecha de registro).
-- =============================================================

ALTER TABLE public.cuentas
  ADD COLUMN IF NOT EXISTS costo_usd    NUMERIC(8,2) CHECK (costo_usd IS NULL OR costo_usd >= 0),
  ADD COLUMN IF NOT EXISTS fecha_compra DATE;
