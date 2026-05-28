# Setup de Supabase para Rey Midas Digitales

Pasos manuales que tenés que hacer **vos** una sola vez. Después me pasás los datos al final y yo dejo todo conectado.

## 1. Crear el proyecto

1. Andá a https://supabase.com y registrate (con Google es más rápido).
2. New project:
   - **Name**: `rey-midas-digitales`
   - **Database password**: poné una contraseña fuerte y guardala.
   - **Region**: `South America (São Paulo)` — la más cercana a Costa Rica.
   - **Pricing plan**: Free.
3. Esperá ~2 minutos a que termine el provisioning.

## 2. Correr el esquema SQL

1. En el dashboard del proyecto, andá a **SQL Editor** (ícono `</>` en la sidebar).
2. Click en **New query**.
3. Abrí el archivo `supabase-schema.sql` de este repo, copiá todo el contenido y pegalo en el editor.
4. Click en **Run** (abajo a la derecha). Debería decir "Success. No rows returned".

## 3. Pasarme los datos de conexión

1. En la sidebar, **Settings** (engranaje abajo) → **API**.
2. Necesitamos tres cosas (todas se configuran en Vercel como env vars):
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` (ej: `https://abcdef.supabase.co`)
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (pública, va al navegador)
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (**secreta**, solo server-side — habilita la API admin para crear clientes)

Si conectaste Supabase vía la integración de Vercel, las dos primeras ya están. La tercera tenés que agregarla a mano:

1. En Vercel → tu proyecto → **Settings** → **Environment Variables**
2. Add new:
   - Name: `SUPABASE_SERVICE_ROLE_KEY`
   - Value: la service_role key de Supabase
   - Environment: **Production** (y Preview / Development si querés)
3. Save y **redesplegá** el proyecto (Vercel → Deployments → ... → Redeploy).

## 4. El primer admin (vos)

El sistema usa **email + contraseña** para todos los logins. No hay magic links ni códigos por email. Necesitás crearte tu cuenta admin a mano:

1. Supabase → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Llená:
   - Email: `grafiticopublicidad@gmail.com`
   - Password: una contraseña fuerte tuya (guardala — es la que vas a usar para entrar al panel admin).
   - **Auto Confirm User**: ACTIVADO (sino te pide verificación por email y no llega).
3. Click **Create user**.
4. Ahora hacete admin en la base de datos. SQL Editor → New query → pegar y correr:
   ```sql
   UPDATE public.profiles SET is_admin = TRUE
   WHERE email = 'grafiticopublicidad@gmail.com';
   ```
5. Andá a https://reymidascr.com/#/login, ingresá tu email + contraseña → ¡adentro! Vas a ver el menú **Admin** en tu perfil.

## 5. Crear cuentas de clientes

A partir de ahora **no usás más el dashboard de Supabase para esto**. Desde la web:

1. Andá a `#/admin` en el sitio.
2. Arriba de todo: **"Crear cliente nuevo"**.
   - Email del cliente.
   - Nombre (opcional).
   - Contraseña inicial (por defecto: `Midas2026` — el cliente la puede cambiar después).
3. Click **Crear cuenta**.
4. Te aparece un mensaje listo para copiar y mandarle al cliente por WhatsApp.
5. Después usá el formulario de abajo para **cargarle compras** a ese cliente.

## 6. Cliente cambia contraseña

Cuando el cliente entra a `#/mi-cuenta`, tiene un botón **"Cambiar contraseña"** para que la actualice cuando quiera.

## ¿Y los emails?

No usamos email para nada del login. Si en algún momento querés agregar recuperación de contraseña por email, lo conectamos con Resend después.
