# Genera las camisetas base de SEARCADE (frente y espalda, blanca y negra) y la
# etiqueta recortada, a partir de la foto de la camiseta blanca colgada sobre
# fondo negro. Uso: python3 -I scripts/searcade-camisetas-base.py foto.webp carpeta_salida
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB"); a = np.asarray(im).astype(np.float32)
L = a.mean(2); H, W = L.shape
# 1) Camiseta = región blanca conectada al centro del pecho
from collections import deque
def relleno(binaria, semilla):
    """Región conectada (4 vecinos) de True que contiene la semilla."""
    vis = np.zeros_like(binaria); y, x = semilla
    if not binaria[y, x]: return vis
    q = deque([(y, x)]); vis[y, x] = True
    while q:
        y, x = q.popleft()
        for ny, nx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
            if 0 <= ny < H and 0 <= nx < W and binaria[ny, nx] and not vis[ny, nx]:
                vis[ny, nx] = True; q.append((ny, nx))
    return vis
comp = relleno(L > 150, (int(H * .55), W // 2))
# 2) Rellenar huecos (la etiqueta): todo lo que no es fondo exterior
fondo = relleno(~comp, (H - 1, 0))
mask = ~fondo
# Quitar lo que queda arriba del cuello (perchero que se cuela por el hueco)
ys, xs = np.nonzero(comp); top = ys.min()
print("tee bbox", xs.min(), ys.min(), xs.max(), ys.max())
# 3) Borde suave
alpha = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
al = np.asarray(alpha).astype(np.float32) / 255
# Etiqueta: píxeles oscuros o con color dentro de la camiseta, en la zona del cuello
sat = a.max(2) - a.min(2)
# Solo el parche oscuro/de color de la etiqueta, cerca del centro del cuello
zona_cuello = np.zeros_like(mask); zona_cuello[ys.min():ys.min() + 140, W // 2 - 90:W // 2 + 90] = True
etiqueta = mask & zona_cuello & ((L < 90) | (sat > 60))
ey, ex = np.nonzero(etiqueta)
eb = (ex.min() - 1, ey.min() - 1, ex.max() + 2, ey.max() + 2)
print("etiqueta", eb)
lab = np.zeros_like(mask); lab[eb[1]:eb[3], eb[0]:eb[2]] = True
# Interior del cuello (se ve la parte de atrás por dentro): dejarlo, es tela
# Recorte final (el mismo para todas las versiones)
CX0, CY0, CX1, CY1 = max(0, xs.min() - 4), max(0, ys.min() - 4), min(W, xs.max() + 5), min(H, ys.max() + 5)
def guardar(rgb, nombre):
    rgba = np.dstack([np.clip(rgb, 0, 255), al * 255]).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA")
    img = img.crop((CX0, CY0, CX1, CY1))
    img.thumbnail((900, 1000), Image.LANCZOS)
    img.save(f"{out}/{nombre}.webp", "WEBP", quality=88, method=6)
    print(nombre, img.size)
    return img
blanca = a.copy()
guardar(blanca, "camiseta-blanca")
# 4) Negra: misma tela y pliegues, luz pasada a tonos oscuros
v = np.clip((L - 150) / 105, 0, 1) ** 1.6
oscuro = 9 + v * 46
negra = np.dstack([oscuro * .96, oscuro * .95, oscuro * 1.02])
negra[lab] = a[lab]
guardar(negra, "camiseta-negra")
# 5) Espalda: misma camiseta sin etiqueta (se rellena con la tela de arriba y abajo)
def sin_etiqueta(rgb):
    out = rgb.copy(); x0, y0, x1, y1 = eb
    arriba, abajo = rgb[y0 - 3], rgb[y1 + 3]
    for y in range(y0, y1):
        t = (y - y0) / max(1, y1 - y0)
        out[y, x0:x1] = arriba[x0:x1] * (1 - t) + abajo[x0:x1] * t
    return out
guardar(sin_etiqueta(blanca), "camiseta-blanca-espalda")
guardar(sin_etiqueta(negra), "camiseta-negra-espalda")
# 6) Etiqueta sola (para ponerla encima cuando la camiseta se tiñe de otro color)
x0, y0, x1, y1 = eb
et = Image.fromarray(np.dstack([a[y0:y1, x0:x1], np.full((y1 - y0, x1 - x0), 255)]).astype(np.uint8), "RGBA")
et.save(f"{out}/etiqueta.webp", "WEBP", quality=92)
cw, ch = CX1 - CX0, CY1 - CY0
print("etiqueta: x %.2f%% y %.2f%% ancho %.2f%% alto %.2f%%" % (100 * (x0 - CX0) / cw, 100 * (y0 - CY0) / ch, 100 * (x1 - x0) / cw, 100 * (y1 - y0) / ch))
print("px por cm (pecho de talla M = 52 cm):", round((xs.max() - xs.min()) * 0.66 / 52, 2), "sobre", cw, "x", ch)
# Zona del pecho en % de la imagen recortada
x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
cw, ch = x1 - x0, y1 - y0
print("zona sugerida: x %.1f  y %.1f  ancho %.1f  alto %.1f" % (100 * (W/2 - cw*.2 - x0) / cw, 100 * (eb[3] + 50 - y0) / ch, 40, 50))
