-- =============================================================
-- Migración: accesos del asistente (permisos limitados)
-- Correr en: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================
-- Cada fila es un acceso que un admin creó en el panel (pestaña Asistente).
-- El token que se entrega lleva el id de la fila; revocar = poner revoked_at.
-- El asistente solo puede: ver cuentas y cupos (sin contraseñas), buscar un
-- cliente por RM (solo el nombre), cargar ventas y registrar/editar cuentas.
-- RLS activado sin políticas: solo el servidor (service_role) la lee.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.asistente_accesos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nota       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

ALTER TABLE public.asistente_accesos ENABLE ROW LEVEL SECURITY;
