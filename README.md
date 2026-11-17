# Calculadora DAN 121 — Tiempos de servicio

Calculadora de **Tiempo de Vuelo (TV)**, **Período de Servicio de Vuelo (PSV)** y **períodos de descanso** de tripulantes de vuelo, según la DAN 121 (Ed. 3), secciones 121.1 y 121.605 (a) y (b).

## Publicar en Vercel

Es un sitio estático, sin compilación:

1. En [vercel.com/new](https://vercel.com/new) importa este repositorio de GitHub.
2. Framework Preset: **Other**. Deja vacíos Build Command y Output Directory.
3. Pulsa **Deploy**. Cada push a la rama de producción vuelve a publicar.

`vercel.json` define las cabeceras del service worker y del manifest.

## Instalar como app (pantalla completa)

- **iPhone / iPad (Safari):** Compartir → *Agregar a pantalla de inicio*. Se abre sin barras del navegador.
- **Android (Chrome):** aparece el botón *Instalar app* en la página (o menú ⋮ → *Instalar app*). Se abre a pantalla completa.

Una vez abierta, funciona sin conexión. El registro queda guardado en el teléfono; usa *Respaldo del registro → Guardar archivo* para copiarlo a Archivos, Drive o correo.

## Uso

Abre la app (o `index.html` en el navegador). Ingresa la fecha, la hora de presentación, los tramos con sus horas de calzos y el término del PSV. Las horas son correlativas: si una hora es menor que la anterior se asume el día siguiente.

Guarda cada servicio en el **registro** para calcular los acumulados. El registro se conserva en el navegador y se puede respaldar o importar como texto JSON.

## Qué verifica

| Control | Límite | Referencia |
|---|---|---|
| PSV jornada ordinaria | 12 h (14 h con contingencia, ≥2 vuelos y sin tocar 21:00–06:00) | 121.605(b)(2)(i)(A), (a)(8), (b)(1)(ii) |
| PSV jornada especial | 20 h | 121.605(b)(2)(i)(A) |
| Servicio previo + PSV | ≤ límite del PSV | 121.605(b)(1)(vii) |
| TV por PSV (ordinaria) | 8 h, −30 min por aterrizaje sobre 5 (tripulación mínima) | 121.605(b)(2)(i)(A), (ii) |
| Horas al mando de controles | 8 h | 121.1 |
| PSV nocturnos consecutivos | tras uno >50 % del período nocturno, solo un segundo de ≤50 % | 121.605(b)(1)(v) |
| TV en 5 días consecutivos | 34 h | 121.605(b)(2)(i)(B) |
| TV en 6 a 10 días consecutivos | 68 h | 121.605(b)(2)(i)(C) |
| TV mes / trimestre / año calendario | 100 h / 270 h / 1.000 h | 121.605(b)(2)(i)(D–F) |
| Descanso tras días continuos | hasta 5 días → 2 días; 6 a 10 días → 4 días | 121.605(a)(9) |

Los criterios de interpretación están detallados al final de la página. No incluye límites de tripulantes de cabina ni disposiciones del Código del Trabajo. Es una herramienta de apoyo: verifica siempre con el texto vigente y con tu operador.

## Desarrollo

La lógica está en `calc.js` (sin dependencias). Pruebas:

```
node --test test/calc.test.js
```
