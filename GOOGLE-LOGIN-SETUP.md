# Setup de "Continuar con Google"

El login con Google **no usa Supabase Auth ni el SDK de Google**: es OAuth2
directo, servidor a servidor. El navegador solo hace una navegación normal
a `/api/auth-google` y vuelve con la sesión ya creada (misma cookie
`rmd_session` de siempre). Por eso no hace falta tocar la CSP ni cargar
ningún script externo.

Si el cliente ya tenía una cuenta con ese email (creada por WhatsApp o desde
`/crear-cuenta`), Google simplemente la loguea — no duplica la cuenta. Si es
la primera vez, se la crea con su número de cliente automático, igual que el
registro manual.

---

## 1. Crear las credenciales en Google Cloud Console

1. Andá a https://console.cloud.google.com/ → creá un proyecto (o usá uno
   existente) para "Rey Midas Digitales".
2. **APIs & Services → OAuth consent screen**:
   - User Type: **External**.
   - Nombre de la app: `Rey Midas Digitales`, email de soporte: el tuyo.
   - Scopes: dejá los básicos (`openid`, `email`, `profile` — no hace falta
     agregar nada a mano, ya vienen).
   - Publicá la pantalla de consentimiento (**Publish app**) para que
     cualquier cuenta de Google pueda entrar, no solo las que agregues como
     "test user".
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: `Rey Midas Digitales - web`.
   - **Authorized redirect URIs** → agregá exactamente:
     ```
     https://reymidascr.com/api/auth-google
     ```
     (sin barra al final, tiene que ser idéntico o Google rechaza el login).
4. Guardá el **Client ID** y el **Client secret** que te muestra.

## 2. Configurar las env vars en Vercel

En Vercel → tu proyecto → **Settings → Environment Variables**, agregá:

| Nombre | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | El Client ID del paso anterior |
| `GOOGLE_CLIENT_SECRET` | El Client secret del paso anterior |

Después de agregarlas, **Redeploy** el proyecto. Mientras estas variables no
estén configuradas, el botón "Continuar con Google" muestra un mensaje de
error en vez de romper el login normal.

## 3. Probar

1. Andá a `https://reymidascr.com/login` → botón **Continuar con Google**.
2. Elegí una cuenta de Google → te tiene que devolver a `/mi-cuenta` ya
   logueado, con un toast mostrando tu número de cliente si la cuenta se
   creó recién.
3. Si algo falla, el error queda en los logs de Vercel con el prefijo
   `[auth-google]`.
