# Etiquetador de Precios — Prototipo funcional

Aplicación web para la generación de etiquetas de precios y promoción para comercios.
Prototipo funcional de orientación evolutiva con flujo vertical: registrar o importar
productos → validar y corregir → seleccionar plantilla → previsualizar → generar PDF.

Proyecto de Software · Ingeniería de Software · Corporación Universitaria Iberoamericana.

## Estructura del proyecto

```
etiquetas-precios/
├── index.html   → estructura de la interfaz (una sola página)
├── styles.css   → estilos (diseño y distribución de la hoja)
├── app.js      → lógica: validaciones, importaciones, cálculo de promociones y generación de PDF
└── README.md   → este archivo
```

La aplicación no necesita servidor ni base de datos: toda la lógica se ejecuta en el
navegador. Las librerías (SheetJS para Excel, pdf-lib para generar PDF y PDF.js para
extraer texto) se cargan desde CDN, por lo que se requiere conexión a internet.

## Requisitos

* Navegador moderno (Chrome, Edge, Firefox o Safari actualizados).
* Conexión a internet (solo para cargar las librerías desde CDN).
* Opcional (para ejecución local): Python 3 instalado, o cualquier servidor estático.

## Instrucciones de instalación y ejecución

### — Ejecución local con Python

1. Descargar o clonar la carpeta `etiquetas-precios`.
2. Abrir una terminal en la carpeta del proyecto.
3. Ejecutar:

```bash
python3 -m http.server 8000
```

4. Abrir en el navegador: `http://localhost:8000`

Para detener el servidor, presionar `Ctrl + C` en la terminal.

## Manual básico de uso

1. **Paso 1 — Productos.** Agregar productos manualmente con el formulario (código,
nombre, precio anterior en COP y descuento porcentual opcional) o importarlos:

   * Botón «Importar Excel (.xlsx)»: acepta la plantilla del proyecto (columnas
`codigo`, `nombre`, `precio\_anterior`, `descuento\_porcentaje`; primera hoja,
encabezados en la primera fila, sin celdas combinadas).
   * Botón «Importar PDF»: acepta únicamente el formato tabular del proyecto con
texto seleccionable (puede descargarse un ejemplo con «Descargar PDF de muestra»).
   * Botón «Descargar plantilla Excel»: entrega el archivo plantilla listo para diligenciar.
   * Botón «Cargar datos de ejemplo»: carga un conjunto de productos de prueba.
2. **Validación y corrección.** Las filas con errores quedan marcadas en rojo con su
motivo; se corrigen con «Editar». Los códigos duplicados se detectan y deben
resolverse antes de exportar.
3. **Paso 2 — Configuración.** Elegir tamaño (pequeña 60×30 mm, mediana 90×40 mm,
grande 90×60 mm) y diseño (básico, precio destacado, promoción o personalizado).
El diseño «personalizado» es un diseño propio con fondo suave, insignia circular
con el porcentaje de descuento, arco y triángulo decorativos y precio destacado
en verde; muestra «Precio anterior» tachado y «Ahora:» cuando hay descuento.
4. **Paso 3 — Vista previa y generación.** Seleccionar los productos (casilla de la
primera columna), revisar la vista previa y pulsar «Generar PDF de etiquetas».
El archivo `etiquetas-precios.pdf` se descarga en el equipo.

## Reglas de negocio implementadas

* Precio actual = precio anterior × (1 − descuento/100), redondeado al peso más
cercano (la fracción de medio peso se redondea hacia arriba).
* El descuento se ingresa solo como porcentaje entre 0 y 100; vacío equivale a 0.
* Precio anterior: número entero mayor que cero, en COP, sin símbolo ni separadores.
* Límites del prototipo: 500 productos y archivos de hasta 5 MB.
* La aplicación no verifica los precios contra sistemas de punto de venta (fuera de alcance).

## Limitaciones conocidas del prototipo

* Sin persistencia: al cerrar o recargar el navegador se pierde la lista (los datos
viven en memoria durante la sesión).
* La importación de PDF solo funciona con la plantilla tabular del proyecto; no se
garantiza la extracción de documentos con otros diseños o tablas en imagen.
* La distribución de etiquetas corresponde a una hoja A4 con márgenes de 10 mm y
separación de 3 mm; no está pensada para hojas adhesivas precortadas.

