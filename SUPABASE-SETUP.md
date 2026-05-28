# Setup de Supabase para Rey Midas Digitales

**IMPORTANTE:** Esta versión usa autenticación propia (custom). Supabase se usa SOLO como base de datos. No hace falta configurar SMTP, providers, magic links ni nada de eso. Olvidate de los rate limits de email.

---

## 1. Crear el proyecto Supabase

1. Andá a https://supabase.com → registrate (con Google es lo más rápido).
2. New project:
   - **Name**: `rey-midas-digitales`
   - **Database password**: poné una fuerte y guardala.
   - **Region**: South America (São Paulo).
   - **Pricing**: Free.
3. Esperá ~2 minutos.

## 2. Correr el esquema SQL

1. Sidebar → **SQL Editor** → **New query**.
2. Copiá todo el contenido de `supabase-schema.sql` → pegalo → **Run**.
3. Debe decir "Success".

> Si ya tenías la versión anterior corriendo: este SQL **borra las tablas viejas** (`profiles`, `purchases`) y las crea de cero. Si tenías datos reales, hacé backup primero. Si no, no pasa nada.

## 3. Configurar las env vars en Vercel

En Vercel → tu proyecto → **Settings → Environment Variables**, agregá:

| Nombre | Valor |
|---|---|
| `SUPABASE_URL` | Project URL de Supabase (ej: `https://abcdef.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key de Supabase (la **secreta**, no la anon) |

Para conseguir esos valores: Supabase → **Settings → API**.

> El `service_role key` da acceso completo a la base. Por eso solo se usa server-side (en `/api/*.js`) y nunca se manda al navegador.

Después de agregarlas, **Redeploy** el proyecto.

## 4. Crear tu cuenta admin (primera vez)

1. Andá a `https://reymidascr.com/#/login`.
2. Como sos el primero en entrar, el sitio detecta que no hay usuarios y te muestra **"Crear primer admin"**.
3. Llená email + nombre + contraseña.
4. Click **Crear cuenta admin** → entrás directamente al panel admin.

Esa cuenta queda como admin para siempre. El botón de "crear primer admin" se deshabilita automáticamente cuando ya hay al menos un usuario.

## 5. Crear cuentas de clientes

Desde el panel `#/admin`:

1. Arriba: **"Crear cliente nuevo"** → email + nombre opcional + contraseña inicial (default `Midas2026`).
2. Click Crear → te aparece el mensaje listo para copiar y mandar al cliente por WhatsApp.
3. Cargale las compras con el formulario de abajo.

El cliente entra con su email + contraseña, ve sus compras en `/mi-cuenta`, y puede cambiar la contraseña cuando quiera.

## ¿Y si pierdo la contraseña de admin?

Como sos el admin único, no hay un "olvidé mi contraseña" automático (eso requeriría SMTP). Pero podés resetearla a mano:

1. Supabase → SQL Editor → New query → corré esto (cambiá `'tu-nueva-pass'`):
```sql
-- Genera un hash scrypt simulado NO sirve, porque la app
-- usa Node.js crypto.scryptSync con formato propio.
-- En su lugar, borrá tu fila y volvé a hacer bootstrap:
DELETE FROM app_users WHERE email = 'grafiticopublicidad@gmail.com';
```
2. Andá a `#/login`, te aparece otra vez "Crear primer admin", creá la cuenta con la contraseña nueva.

(Solo funciona si vos sos el único usuario; si ya creaste clientes, eliminarte borraría sus compras por la cascada. En ese caso pedime que te arme un endpoint de reset y lo agrego.)
