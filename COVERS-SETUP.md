# Carátulas en Bana Hosting — cómo funciona

Objetivo: que las portadas de los juegos **featured** (las que antes dependían
de RAWG y se caían cuando se agotaba el cupo) vivan en **Bana Hosting** y el
sitio las cargue directo de ahí. Cero cupo de RAWG, carga rápida.

## Cómo funciona (en una imagen)

```
GitHub Action "Harvest covers to Bana"  (corre en servidores de GitHub)
        │  1. lee featured-games.json
        │  2. busca cada carátula en RAWG (una sola vez)
        │  3. sube la imagen por FTP a Bana → carpeta /covers
        │  4. detecta la URL pública que sirve Bana
        ▼
   commitea covers.json al repo   (id de juego → URL en Bana)
        ▼
   el sitio (app.js) lee /covers.json y usa esas URLs
        → si un juego está en Bana, NUNCA le pide la portada a RAWG
```

Las imágenes pesadas viven en Bana. El índice liviano (`covers.json`) vive en
el repo y lo sirve Vercel desde el mismo dominio (necesario por la CSP).

## Setup por única vez (todo desde la web, sin terminal)

1. Entrá a tu repo en GitHub → **Settings** → **Secrets and variables** →
   **Actions** → botón **New repository secret**. Agregá estos cuatro:

   | Nombre del secret | Valor |
   |---|---|
   | `RAWG_API_KEY`  | tu API key de RAWG |
   | `BANA_HOST`     | `ftp.grafticocr.com` |
   | `BANA_USER`     | `haiku@reymidascr.com` |
   | `BANA_PASSWORD` | tu contraseña FTP de Bana |

   (Opcional) `BANA_PUBLIC_URL` si ya sabés el dominio que sirve Bana, ej
   `https://grafiticocr.com/covers`. Si no lo ponés, la Action lo detecta sola.

2. Andá a la pestaña **Actions** → elegí **Harvest covers to Bana** →
   botón **Run workflow**. Listo: cosecha y sube todo.

Después corre solo una vez por semana para agarrar los juegos nuevos que
agregues a `featured-games.json`.

## Si la detección de URL pública falla

La Action sube los archivos igual, pero te avisa que ningún dominio probado
los devuelve. Eso pasa si el dominio (`reymidascr.com`) apunta a Vercel y no a
Bana. Solución: usá el dominio real de tu cuenta Bana o creá un subdominio
(ej `cdn.reymidascr.com`) apuntando a Bana, y pasalo en `BANA_PUBLIC_URL`.
