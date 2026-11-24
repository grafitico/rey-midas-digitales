# Genera las camisetas de ESPALDA de SEARCADE (blanca y negra) a partir de la
# foto de espalda del dueño (camiseta de color colgada sobre fondo negro).
# Usa el mismo recorte que scripts/searcade-camisetas-base.py para que frente y
# espalda calcen exacto al girar la camiseta.
#
# Uso: python3 -I scripts/searcade-espalda.py foto-espalda.webp carpeta_salida
import sys
import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
# Recorte de la foto del frente (misma sesión de fotos, mismo encuadre)
CX0, CY0, CX1, CY1 = 74, 194, 1126, 1269

im = Image.open(src).convert("RGB")
a = np.asarray(im).astype(np.float32)
r, g, b = a[..., 0], a[..., 1], a[..., 2]

# 1) La camiseta: el color de la tela se distingue del fondo negro y del gancho gris
canal = a.max(2)
sat = canal - a.min(2)
mask = (canal > 90) & (sat > 50)
alpha = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.1))
al = np.asarray(alpha).astype(np.float32) / 255

# 2) Luz de la tela (sombras y pliegues) a partir del canal más brillante
lum = canal
p_baja, p_alta = np.percentile(lum[mask], [2, 98])
v = np.clip((lum - p_baja) / max(1, p_alta - p_baja), 0, 1)

def guardar(gris, nombre):
    rgb = np.dstack([gris, gris, gris])
    rgba = np.dstack([np.clip(rgb, 0, 255), al * 255]).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA").crop((CX0, CY0, CX1, CY1))
    img.thumbnail((900, 1000), Image.LANCZOS)
    img.save(f"{out}/{nombre}.webp", "WEBP", quality=88, method=6)
    print(nombre, img.size)

# Blanca: mismos tonos que la foto blanca del frente (≈205–250)
blanca = 200 + v * 50
guardar(blanca, "camiseta-blanca-espalda")
# Negra: misma fórmula que el frente negro
oscuro = 9 + (v ** 1.6) * 46
negra = np.dstack([oscuro * .96, oscuro * .95, oscuro * 1.02])
rgba = np.dstack([np.clip(negra, 0, 255), al * 255]).astype(np.uint8)
img = Image.fromarray(rgba, "RGBA").crop((CX0, CY0, CX1, CY1))
img.thumbnail((900, 1000), Image.LANCZOS)
img.save(f"{out}/camiseta-negra-espalda.webp", "WEBP", quality=88, method=6)
print("camiseta-negra-espalda", img.size)

# Dónde empieza el estampado de espalda: ~8 cm (13,24 px/cm) bajo la costura del cuello
col = mask[:, (CX0 + CX1) // 2]
ys = np.nonzero(col)[0]
cuello_arriba = ys.min()
# la costura del cuello es la franja más oscura cerca del borde superior
fila = lum[cuello_arriba:cuello_arriba + 80, (CX0 + CX1) // 2]
costura = cuello_arriba + int(np.argmin(fila))
top = (costura + 8 * 13.24 - CY0) / (CY1 - CY0) * 100
print(f"cuello de atrás en y={costura}px → estampado de espalda desde top {top:.1f}%")
