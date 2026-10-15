# Respuesta: logo y nombre de Devitrak rotos en el preview (2026-10-07)

Respuesta a `FRONTEND_email_branding_devitrak_assets_2026-10-07.md`.

## Causa

No era la URL ni un `cid:` (ninguna plantilla incrusta imágenes como adjunto).
La versión desplegada servía los PNG desde el propio API
(`https://db.devitrak.net/assets/devitrak_email_{icon,name}.png`). Esas URLs
responden 200, pero `helmet()` les pone:

```
Cross-Origin-Resource-Policy: same-origin
```

Con esa cabecera, el navegador **se niega a pintar la imagen en cualquier página
de otro origen**, como el iframe del preview del dashboard. Por eso se ven
como imagen rota aunque la petición sea 200. A los clientes de correo nativos y
a los webmail que pasan las imágenes por proxy (Gmail) no les afecta, pero a
un webmail que las cargue directo desde el navegador sí.

## Arreglo (backend, commit `90bf3c3` en `release/observabilidad`)

Las plantillas ya no usan esas URLs. Ahora usan **los dos assets de Cloudinary**
que menciona el documento (`devitrak_name_wls6qd` y `devitrak_login_jeki3x`), y
Cloudinary los entrega sin CORP y con `Access-Control-Allow-Origin: *`:

| Imagen | URL que va en el correo |
|---|---|
| Nombre | `https://res.cloudinary.com/dpdzkhh07/image/upload/h_66,e_colorize:100,co_rgb:101828/v1791386367/devitrak_name_wls6qd.png` |
| Logo | `https://res.cloudinary.com/dpdzkhh07/image/upload/h_66,e_replace_color:155eef:15:ffffff/v1791386367/devitrak_login_jeki3x.png` |

Sobre las propuestas del documento:

- **PNG en vez de SVG**: sí, la URL pide `.png`. Además lleva `h_66`, que lo genera a 3x de los 22 px a los que se pinta. Sin eso, Cloudinary genera el PNG a 22 px y se ve pixelado.
- **Fondo oscuro `#021833`**: no hace falta. En vez de oscurecer la cabecera, Cloudinary cambia el color de los SVG blancos (nombre `#101828`, icono blanco → `#155eef`, el gris `#8A9DAD` se queda). La cabecera sigue sobre el fondo blanco de la tarjeta y el diseño no cambia.
- **`width`/`height` y `alt`**: ya están. 47×22 y 105×22 en la cabecera, 26×12 y 57×12 en el "Powered by" de las plantillas antiguas, y hay un test que exige el tamaño en todo `<img>` de Devitrak.

## Qué falta

Desplegar `release/observabilidad` (incluye `90bf3c3`). Después, comprobar
abriendo el preview: tiene que verse el icono azul y el nombre oscuro. El
dashboard no tiene que cambiar nada.
