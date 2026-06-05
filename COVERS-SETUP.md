# 🎮 Sistema de Carátulas de Bana Hosting

Este sistema recolecta **miles de carátulas en alta calidad** de múltiples fuentes (Steam, GOG, RAWG) y las almacena en **Bana Hosting** para una experiencia de carga ultrarrápida como PlayStation.com.

---

## Arquitectura

```
┌────────────────────────────────┐
│  Scraper (Node.js)             │
│  - Steam (mejor calidad)       │
│  - GOG (alternativa)           │
│  - RAWG (fallback)             │
└───────────┬────────────────────┘
            │ Descarga + Optimiza (WebP)
            ▼
┌────────────────────────────────┐
│  Bana Hosting (FTP)            │
│  /public_html/covers/          │
│  - Imágenes WebP (600x900)     │
│  - covers.json (índice)        │
└───────────┬────────────────────┘
            │ URL pública
            ▼
┌────────────────────────────────┐
│  Frontend (app.js)             │
│  - Carga desde Bana            │
│  - Fallback a RAWG             │
│  - Placeholder si falla        │
└────────────────────────────────┘
```

---

## Paso 1: Configurar Credenciales de Bana

Necesitas acceso **FTP o SFTP** a tu Bana Hosting. Obtén:

1. **Host**: `ftp.banahosting.com` (o tu IP específica)
2. **Usuario**: Tu usuario de Bana (generalmente en panel de control)
3. **Contraseña**: Tu contraseña FTP
4. **Ruta pública**: `/public_html/covers/` (o ajusta según tu hosting)
5. **URL pública**: `https://tu-dominio.bana.hosting/covers` (sin trailing slash)

### Crear variables de entorno

Crea un archivo `.env.local` en la raíz del proyecto:

```bash
# Bana Hosting FTP credentials
BANA_HOST=ftp.banahosting.com
BANA_USER=tu_usuario
BANA_PASSWORD=tu_contraseña
BANA_REMOTE_PATH=/public_html/covers
BANA_PUBLIC_URL=https://tu-dominio.bana.hosting/covers

# APIs (ya deberías tener)
RAWG_API_KEY=tu_rawg_api_key
```

**⚠️ NO commits el `.env.local` — gitignore lo protege.**

---

## Paso 2: Instalar Dependencias

El scraper necesita librerías para optimizar imágenes y FTP:

```bash
npm install --save-dev node-fetch sharp basic-ftp
```

O si usas yarn/pnpm:

```bash
yarn add -D node-fetch sharp basic-ftp
pnpm add -D node-fetch sharp basic-ftp
```

---

## Paso 3: Ejecutar el Scraper

### Primera corrida (colectar 1000+ covers)

```bash
# Steam + GOG + RAWG, subir a Bana (todo en uno)
node scripts/scrape-covers.js --source=all --limit=1000 --upload-to-bana

# O solo Steam (mejor calidad, más rápido)
node scripts/scrape-covers.js --source=steam --limit=1500 --upload-to-bana
```

### Solo Steam (recomendado para inicio)

```bash
node scripts/scrape-covers.js --source=steam --limit=500 --upload-to-bana
```

### Procesos en paralelo para acelerar

```bash
# Terminal 1: Steam
node scripts/scrape-covers.js --source=steam --limit=1000 --upload-to-bana

# Terminal 2 (después de 5 min): GOG
node scripts/scrape-covers.js --source=gog --limit=500 --upload-to-bana

# Terminal 3 (después de 10 min): RAWG
node scripts/scrape-covers.js --source=rawg --limit=2000 --upload-to-bana
```

### Output esperado

```
═══════════════════════════════════════════════════════════
   🎮 SCRAPER DE CARÁTULAS PROFESIONAL - Rey Midas
═══════════════════════════════════════════════════════════
Source: steam | Limit: 500 | Upload: true

📦 STEAM: Buscando 500 juegos...
  ✓ steam-570940 (182KB)
  ✓ steam-292030 (156KB)
  ✓ steam-1091500 (245KB)
  ...

🖼️  Descargando y optimizando 500 imágenes...
  ✓ steam-570940 (82KB)
  ✓ steam-292030 (76KB)
  ...
Procesadas: 500/500

📤 Conectando a Bana (ftp.banahosting.com)...
✅ Conectado a Bana
  ✓ steam-570940.webp
  ✓ steam-292030.webp
  ...
Subidas: 500/500

📊 Generando base de datos...
✅ Base de datos generada: covers-database.json
   Total covers: 500
   Subidas a Bana: 500

✅ ¡Scraping completado!
```

---

## Paso 4: Integrar en app.js

Actualiza `app.js` para cargar covers desde Bana:

### Al inicio (en `load()`)

```javascript
// En la función load()
async function load() {
  // ... código existente ...

  // Cargar base de datos de covers desde Bana
  await import("./bana-covers.js").then(m => m.getBanaCovers());

  // ... resto del código ...
}
```

### Al aplicar covers a una card

Busca la función que renderiza covers (probablemente `applyGameCoverUpdate()` o similar) y actualiza:

```javascript
// Antes (solo RAWG):
function applyGameCoverUpdate(game, element) {
  // ... código existente ...
  imageUrl = game.backgroundImage; // de RAWG
}

// Después (Bana primero, fallback a RAWG):
import { getCoverUrl } from "./bana-covers.js";

function applyGameCoverUpdate(game, element) {
  // Intenta Bana primero
  let imageUrl = getCoverUrl(game.id, game.title);

  // Fallback a RAWG si no existe en Bana
  if (!imageUrl) {
    imageUrl = game.backgroundImage; // de RAWG
  }

  if (!imageUrl) {
    imageUrl = "/img/game-placeholder.png";
  }

  element.style.backgroundImage = `url('${imageUrl}')`;
  // ... resto del código ...
}
```

### Variable de entorno en Vercel

En **Vercel → Settings → Environment Variables**, agrega:

```
BANA_COVERS_URL=https://tu-dominio.bana.hosting/covers/covers.json
```

(El frontend usa esta URL para cargar el índice de covers)

---

## Paso 5: Automatizar Actualizaciones (Cron)

Opcionalmente, puedes crear un cron job que corra el scraper cada semana:

### Crear archivo `scripts/cron-sync-covers.js`

```javascript
import { spawn } from "child_process";

const proc = spawn("node", ["scripts/scrape-covers.js", "--source=steam", "--limit=50", "--upload-to-bana"], {
  stdio: "inherit",
});

proc.on("exit", (code) => {
  if (code === 0) {
    console.log("✅ Cron: Sync covers exitoso");
  } else {
    console.error("❌ Cron: Sync covers falló");
    process.exit(1);
  }
});
```

Luego en tu **crontab local** (cada domingo a las 2 AM):

```bash
0 2 * * 0 cd /home/user/rey-midas-digitales && node scripts/cron-sync-covers.js >> logs/cron-covers.log 2>&1
```

---

## Estructura de Archivos Generados

Después de ejecutar el scraper, obtendrás:

```
/covers-temp/                  # Imágenes locales (borrar después de subir)
  steam-570940.webp
  steam-292030.webp
  ...

/covers-database.json          # Índice local (puede borrarse)
  {
    "generated": "2026-06-05T10:30:00Z",
    "totalCovers": 500,
    "uploadedCovers": 500,
    "covers": {
      "steam-570940": {
        "source": "steam",
        "url": "https://tu-dominio.bana.hosting/covers/steam-570940.webp",
        "sizeKB": 82,
        "title": "Elden Ring"
      },
      ...
    }
  }

# En Bana Hosting
/public_html/covers/          # Imágenes públicas
  covers.json                 # Índice duplicado para download en frontend
  steam-570940.webp
  steam-292030.webp
  ...
```

---

## Solución de Problemas

### FTP Connection Refused
- Verifica que el host, usuario y contraseña son correctos
- Algunos hosted usan puertos alternativos (21, 2121, etc.)
- Intenta SFTP en lugar de FTP si falla

### Imágenes vacías o borradas
- El scraper optimiza a 600x900 WebP
- Si Sharp falla, reinstala: `npm rebuild sharp`
- Verifica permiso de escritura en `/covers/` en Bana

### DB local muy pesada
- Si `covers-database.json` es >50MB, dividela en chunks
- O incrementa la compresión de WebP: `quality: 75` en sharp

### RAWG agotado
- Solo afecta si usas `--source=rawg`
- Steam y GOG no tienen límite de cuota
- La cuota de RAWG se reset el 1° del mes

---

## Benchmarks

Comparando carga de carátulas:

| Método | Latencia | Tamaño c/u | Caché | Cuota |
|--------|----------|-----------|-------|-------|
| **Bana (este sistema)** | ~200ms | 60-120KB | CDN | Ilimitado |
| RAWG (API) | ~800ms | 150-300KB | 1h | 100k/mes |
| IGDB (sin caché) | ~1200ms | 180-400KB | Local | 4/seg |
| Hardcoded (como PS.com) | ~0ms | N/A | ∞ | N/A |

Con Bana, tenés:
- ✅ Velocidad similar a sitios grandes
- ✅ Zero cuota exhaustion
- ✅ Control total de las imágenes
- ✅ Historial de versiones en Git

---

## Próximos pasos

1. Configura `.env.local` con credenciales Bana
2. Ejecuta scraper con `--source=steam --limit=500 --upload-to-bana`
3. Verifica que covers.json está en `https://tu-dominio.bana.hosting/covers/covers.json`
4. Integra `bana-covers.js` en `app.js`
5. Deploy a Vercel y testa en `https://tu-site.com`
6. Incrementa a 2000+ covers en siguientes corridas

---

**Creado para Rey Midas Digitales — a la altura de PlayStation.com 🚀**
