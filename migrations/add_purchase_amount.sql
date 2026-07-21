-- Monto que pagó el cliente por la compra, en colones (₡).
-- Se usa para el historial de ventas por día/mes desglosado por consola.
-- NUMERIC(12,2) aguanta hasta ~9,999,999,999.99 con dos decimales.
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2);

-- Índice por fecha para que los reportes de ventas por rango sean rápidos.
CREATE INDEX IF NOT EXISTS purchases_purchase_date_idx
  ON public.purchases (purchase_date);
