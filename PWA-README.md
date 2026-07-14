# App instalable (PWA) — Rey Midas Digitales

La web ahora es una **PWA instalable**: la gente puede instalarla en el celular
(Android e iPhone) y en la compu, con ícono propio, pantalla completa y carga
rápida incluso sin buena señal. **Cero costo** y compatible con todos los
dispositivos.

## Qué se agregó

| Archivo | Para qué |
|---|---|
| `manifest.webmanifest` | Nombre, colores, íconos y accesos directos de la app |
| `service-worker.js` | Caché para carga rápida + funcionamiento offline |
| `pwa.js` | Registra el SW, muestra el botón "Instalar app" y avisa de actualizaciones |
| `assets/icons/` | Íconos generados desde `assets/logo.png` (192, 512, maskable, apple-touch) |

`index.html` enlaza el manifest y los íconos; `vercel.json` fija los headers de
caché correctos (el service worker se revalida siempre para que las
actualizaciones lleguen).

## Cómo la instala la gente

- **Android (Chrome):** aparece el botón dorado **"Instalar app"** abajo a la
  izquierda, o el menú ⋮ → *Instalar aplicación*.
- **iPhone/iPad (Safari):** botón *Compartir* → **Agregar a inicio**. La web
  muestra una pista automática la primera vez.
- **Escritorio (Chrome/Edge):** ícono de instalar en la barra de direcciones o
  el botón "Instalar app".

## Cómo actualizar la app

No hay que hacer nada especial: cada `deploy` a Vercel actualiza la PWA sola.
Cuando hay una versión nueva, al usuario le aparece un aviso **"Actualizar"**.

Si cambiás los íconos o el estilo de forma importante, subí el número de versión
del caché en `service-worker.js` (`CACHE_VERSION`) para forzar el refresco.

### Regenerar los íconos (si cambia el logo)

Los íconos se generan desde `assets/logo.png` con `sharp`:

```bash
npm i --no-save sharp
node - <<'EOF'
import('sharp').then(async ({default:sharp})=>{
  const BG={r:7,g:7,b:12,alpha:1};
  const mk=async(size,pad,out)=>{
    const inner=Math.round(size*(1-pad*2));
    const logo=await sharp('assets/logo.png').resize({width:inner,height:inner,fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
    await sharp({create:{width:size,height:size,channels:4,background:BG}}).composite([{input:logo,gravity:'center'}]).png().toFile(out);
  };
  await mk(192,0.10,'assets/icons/icon-192.png');
  await mk(512,0.10,'assets/icons/icon-512.png');
  await mk(192,0.20,'assets/icons/maskable-192.png');
  await mk(512,0.20,'assets/icons/maskable-512.png');
  await mk(180,0.12,'assets/icons/apple-touch-icon.png');
});
EOF
```

## Más adelante: `.apk` real para Google Play (opcional, gratis)

Cuando quieras una app descargable de Play Store, **no hay que reescribir nada**:
esta misma PWA se empaqueta automáticamente.

1. Entrá a **https://www.pwabuilder.com** e ingresá `https://reymidascr.com`.
2. Descargá el paquete **Android** (genera un `.aab`/`.apk` firmado — TWA).
3. Subilo a **Google Play Console** (costo único de Google: **$25**).

Para iOS App Store se requiere Mac + cuenta Apple Developer ($99/año); la PWA ya
cubre iPhone gratis vía "Agregar a inicio", así que ese paso es opcional.
