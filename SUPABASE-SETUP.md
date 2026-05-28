# Setup de Supabase para Rey Midas Digitales

Pasos manuales que tenés que hacer **vos** una sola vez. Después me pasás los 2 datos al final y yo dejo todo conectado.

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

## 3. Configurar el email de autenticación

El login es por **email mágico** — el cliente ingresa su correo y recibe un link para entrar, sin contraseña. Supabase lo tiene activado por defecto, no necesitás configurar nada extra.

Lo único que debés hacer es poner la URL correcta del sitio:

1. En la sidebar, **Authentication** → **URL Configuration**.
2. **Site URL**: `https://reymidascr.com`
3. **Redirect URLs** (agregá ambas):
   - `https://reymidascr.com`
   - `https://reymidascr.com/*`
4. Guardá.

## 4. Pasarme los datos de conexión

1. En la sidebar, **Settings** (engranaje abajo) → **API**.
2. Copiá dos cosas y pasámelas por chat:
   - **Project URL** (algo como `https://abcdefghij.supabase.co`)
   - **anon public** key (clave larga que empieza con `eyJ...`)

> Esa clave es **pública por diseño** (Supabase la llama "anon key" justamente porque va en el JS del navegador). La seguridad real la garantiza el RLS que ya cargamos en el SQL.

## 5. Después del primer login

Cuando el código esté deployado y vos te logueés por primera vez en https://reymidascr.com:

1. Volvé a Supabase → SQL Editor → New query.
2. Pegá y corré (con tu email):
   ```sql
   UPDATE public.profiles SET is_admin = TRUE
   WHERE email = 'grafiticopublicidad@gmail.com';
   ```
3. Recargá la web y vas a tener acceso a la pestaña **Admin**.

## ¿Y después?

Una vez que estés admin podés:
- Cargar compras de cualquier cliente desde el panel `/admin` del sitio.
- Cada cliente que se loguee verá **sus** compras en `/mi-cuenta` (no las de otros — RLS lo bloquea a nivel base de datos).
