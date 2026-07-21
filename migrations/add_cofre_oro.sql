-- =============================================================
-- Migración: Cofre de Oro del Rey Midas
-- Correr en: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================
-- Cada compra registrada suma 1 moneda de oro al cliente. Al juntar
-- 7 monedas puede canjear un juego gratis del listado especial
-- (cofre-games.json). El canje se registra como una compra más con
-- is_redemption = TRUE: entrega la cuenta igual que una venta normal,
-- pero no suma moneda y descuenta 7 del contador del cliente.
-- =============================================================

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS is_redemption BOOLEAN NOT NULL DEFAULT FALSE;
