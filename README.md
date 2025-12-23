# Documentación del API de Gestión de Laboratorio Clínico
**Versión:** 1.0  
**Tecnología:** Google Apps Script + Google Sheets + AppSheet  
**Fecha:** Diciembre 2025

---

## 1. Descripción General
Este aplicativo funciona como un **Backend Serverless** alojado en Google Apps Script. Su función principal es procesar lógicas complejas que AppSheet no puede realizar nativamente, tales como:
*   Generación de reportes médicos (PDF) con diseños complejos (tablas dinámicas, saltos de página, membretes).
*   Generación de cotizaciones/facturas.
*   Carga masiva de parámetros de estudios (lógica de bucles).
*   Actualización de registros específicos.
*   Descarga de reportes consolidados en Excel.

El sistema recibe peticiones HTTP `GET` a través de un único "Endpoint" (la URL del Script), y un enrutador interno (`doGet`) decide qué función ejecutar basándose en el parámetro `accion`.

---

## 2. Estructura de Archivos
El proyecto en el editor de Apps Script consta de 4 archivos esenciales:

| Archivo | Tipo | Descripción |
| :--- | :--- | :--- |
| **`Code.gs`** | Servidor | Contiene toda la lógica del negocio, el enrutador (`doGet`), validación de tokens y conexión a la Base de Datos (Google Sheet). |
| **`Report.html`** | Vista | Plantilla HTML/CSS para la impresión de **Resultados de Laboratorio**. Incluye lógica para repetición de encabezados, firma digital y fondos membretados. |
| **`template.html`** | Vista | Plantilla HTML/CSS para la impresión de **Facturas/Cotizaciones**. |
| **`index.html`** | Vista | Interfaz de usuario (Spinner) para la **Carga de Parámetros** de estudios. Muestra el progreso al usuario. |

---

## 3. Base de Datos (Google Sheets)
El sistema requiere un libro de cálculo con las siguientes hojas (Tablas) y estructuras clave:

*   **`BD_PX`**: Información de Pacientes (`id-px`, `name-px`, etc.).
*   **`BD_FACT`**: Cabecera de Facturas/Servicios (`id-fact`, `id-service`, etc.).
*   **`BD_FACT_DETAIL`**: Detalle de estudios por factura (`id-fact-estudio`).
*   **`BD_RESULTADOS`**: Almacén de resultados (`id-result`, `cuantitativo-result`, etc.).
*   **`tbl_familia`**: Agrupación de exámenes (Hematología, Química) y configuración de encabezados de tabla.
*   **`tbl_parametro`**: Configuración de cada prueba (Unidades, Rangos de referencia).
*   **`tbl_relaciones`**: Control de seguridad (Tokens).

---

## 4. Endpoints y Parámetros (API Reference)

La URL base es la proporcionada al implementar la aplicación web (`.../exec`).

### A. Imprimir Resultados Médicos
Genera una vista HTML lista para imprimir o guardar como PDF.

*   **Acción:** `printresult`
*   **Seguridad:** Acceso público (o validado según configuración).
*   **Parámetros:**

| Parámetro | Obligatorio | Descripción |
| :--- | :---: | :--- |
| `idgs` | Sí | ID del Libro de Google Sheets. |
| `id-fact` | Sí | ID interno de la factura/servicio a imprimir. |
| `url_img` | No | URL pública de la imagen de fondo (Membrete). |
| `url_firma` | No | URL pública de la imagen de la firma (PNG transparente). |
| `col_bg` | No | Color de fondo para encabezados de tabla (Hex, ej: `#00b0f0`). |
| `col_txt` | No | Color de texto para encabezados de tabla (Hex, ej: `#ffffff`). |

### B. Imprimir Factura / Cotización
Genera el formato administrativo de la orden.

*   **Acción:** `print_fact`
*   **Seguridad:** Requiere Token.
*   **Parámetros:**

| Parámetro | Obligatorio | Descripción |
| :--- | :---: | :--- |
| `idgs` | Sí | ID del Libro de Google Sheets. |
| `token` | Sí | Token de seguridad válido en `tbl_relaciones`. |
| `idvnt` | Sí | ID de la factura (`id-fact`). |
| `idimgurl` | No | URL del logo de la empresa para la cabecera. |

### C. Carga de Parámetros (WebApp)
Interfaz que inserta masivamente los parámetros vacíos en `BD_RESULTADOS` para los estudios seleccionados.

*   **Acción:** `load-param=true` (Trigger especial).
*   **Seguridad:** Requiere Token implícito o sesión.
*   **Parámetros:**

| Parámetro | Descripción |
| :--- | :--- |
| `modo` | `particular` (un solo estudio) o `lote` (toda la factura). |
| `id-fact` | ID de la factura. |
| `id-estudio` | ID del estudio (solo en modo particular). |

---

## 5. Integración con AppSheet

Para consumir este API desde AppSheet, se debe crear una acción de tipo **"External: Go to a website"**. Es crucial usar `ENCODEURL()` para URLs de imágenes y colores hexadecimales.

### Fórmula: Imprimir Resultados
```excel
CONCATENATE(
  "https://script.google.com/macros/s/ID_DE_TU_SCRIPT/exec",
  "?accion=printresult",
  "&idgs=", "ID_HOJA_GOOGLE_SHEET",
  "&id-fact=", [id-fact],
  "&url_img=", ENCODEURL("https://tudominio.com/tu-membrete.jpg"),
  "&url_firma=", ENCODEURL([LinkFirma]), 
  "&col_bg=", ENCODEURL("#00b0f0"),
  "&col_txt=", ENCODEURL("#ffffff")
)
```

### Fórmula: Imprimir Factura
```excel
CONCATENATE(
  "https://script.google.com/macros/s/ID_DE_TU_SCRIPT/exec",
  "?accion=print_fact",
  "&idgs=", "ID_HOJA_GOOGLE_SHEET",
  "&token=", "TU_TOKEN_SECRETO",
  "&idvnt=", [id-fact],
  "&idimgurl=", [LinkLogoEmpresa]
)
```

---

## 6. Mantenimiento y Solución de Problemas

### Despliegue de Cambios
Cada vez que se modifica el código (`Code.gs` o HTML), se debe crear una nueva versión para que sea visible en producción:
1.  Clic en **Implementar** > **Gestionar implementaciones**.
2.  Clic en **Editar** (ícono de lápiz).
3.  Versión: Seleccionar **"Nueva versión"**.
4.  Clic en **Implementar**.

### Problemas Comunes

1.  **Error "Acceso Denegado"**:
    *   Verificar que el `token` enviado coincida con el de la hoja `tbl_relaciones`.
    *   Verificar que la implementación esté configurada como "Ejecutar como: Yo" y "Quién tiene acceso: Cualquiera".

2.  **No se ve el fondo o la firma al imprimir**:
    *   En la ventana de impresión del navegador, desplegar "Más ajustes" y marcar la casilla **"Gráficos de fondo" (Background graphics)**.

3.  **Encabezados de tabla no coinciden**:
    *   Verificar la tabla `tbl_familia`. El reporte es dinámico y usa los campos `header-family-01`, `02`, etc., de esa tabla. Si están vacíos, usará los valores por defecto.

4.  **La firma sale cortada**:
    *   El CSS tiene la propiedad `page-break-inside: avoid` en la clase `.signature-section`. Si la firma es muy grande, intenta reducir su tamaño visual editando el CSS en `Report.html` (`max-height: 80px`).
