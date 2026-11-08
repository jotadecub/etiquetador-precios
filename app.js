/* ============================================================
   Etiquetador de Precios — prototipo funcional
   Aplicación de una sola página, sin servidor: toda la lógica se
   ejecuta en el navegador. Persistencia: en memoria (limitación
   declarada del prototipo).
   ============================================================ */

'use strict';

/* ---------- Constantes de negocio (contrato de datos) ---------- */

const LIMITE_PRODUCTOS = 500;   // máximo de productos admitidos
const LIMITE_ARCHIVO_MB = 5;    // tamaño máximo de archivo importado

// Definición de tamaños: dimensiones en mm y distribución en hoja A4
// (210 × 297 mm, márgenes de 10 mm, separación de 3 mm).
const TAMANOS = {
  pequeno: { etiqueta: 'Pequeña (60 × 30 mm)', ancho: 60, alto: 30, porHoja: 24 },
  mediano: { etiqueta: 'Mediana (90 × 40 mm)', ancho: 90, alto: 40, porHoja: 12 },
  grande:  { etiqueta: 'Grande (90 × 60 mm)', ancho: 90, alto: 60, porHoja: 8 },
};

const MARGEN_MM = 10; // margen de la hoja
const SEPARACION_MM = 3; // separación entre etiquetas

// Columnas esperadas en los archivos de importación
const COLUMNAS_OBLIGATORIAS = ['codigo', 'nombre', 'precio_anterior'];
const COLUMNAS_ADMITIDAS = [...COLUMNAS_OBLIGATORIAS, 'descuento_porcentaje'];

/* ---------- Utilidades ---------- */

const $ = (sel) => document.querySelector(sel);
const fmtCOP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

function mmAPt(mm) { return mm * 72 / 25.4; }

function normalizarEncabezado(t) {
  return String(t ?? '')
    .trim()
    .toLowerCase()
    .replace(/[._\s-]+/g, '_')
    .replace(/%$/, '')
    .replace(/^%/, '');
}

/** Redondeo al peso más cercano; la fracción de medio peso se redondea hacia arriba. */
function redondearCOP(valor) {
  return Math.floor(valor + 0.5);
}

/** Precio actual = precio anterior × (1 − descuento/100), redondeado al peso. */
function precioActual(p) {
  const precio = Number(p.precio_anterior);
  const desc = descuentoDe(p);
  return redondearCOP(precio * (1 - desc / 100));
}

/** Descuento porcentual de un producto (vacío se interpreta como 0). */
function descuentoDe(p) {
  const d = p.descuento_porcentaje;
  if (d === '' || d === null || d === undefined) return 0;
  return Number(d);
}

function toast(mensaje) {
  const el = $('#toast');
  el.textContent = mensaje;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 4000);
}

/* ---------- Estado ---------- */

/** @type {Array<{id:number, codigo:string, nombre:string, precio_anterior:string, descuento_porcentaje:string, origen:string, errores:string[]}>} */
let productos = [];
let seleccion = new Set();
let contadorId = 1;

/* ---------- Validación ---------- */

/**
 * Valida un producto contra las reglas del contrato de datos.
 * @returns {string[]} lista de errores (vacía si es válido)
 */
function validarProducto(p) {
  const errores = [];

  if (!String(p.codigo ?? '').trim()) errores.push('El código es obligatorio.');

  if (!String(p.nombre ?? '').trim()) errores.push('El nombre es obligatorio.');

  const precioTexto = String(p.precio_anterior ?? '').trim();
  const precio = Number(precioTexto);
  if (!precioTexto) {
    errores.push('El precio anterior es obligatorio.');
  } else if (!Number.isFinite(precio) || !Number.isInteger(precio) || precio <= 0) {
    errores.push('El precio anterior debe ser un número entero mayor que cero (COP, sin separadores).');
  }

  const descTexto = String(p.descuento_porcentaje ?? '').trim();
  if (descTexto !== '') {
    const desc = Number(descTexto);
    if (!Number.isFinite(desc) || desc < 0 || desc > 100) {
      errores.push('El descuento debe ser un número entre 0 y 100.');
    }
  }

  return errores;
}

/** Detecta códigos duplicados y agrega el error correspondiente. */
function marcarDuplicados() {
  const vistos = new Map();
  for (const p of productos) {
    const clave = String(p.codigo ?? '').trim();
    if (vistos.has(clave)) {
      vistos.get(clave).push(p);
    } else {
      vistos.set(clave, [p]);
    }
  }
  for (const p of productos) {
    p.errores = p.errores.filter((e) => !e.startsWith('El código ya existe'));
    const clave = String(p.codigo ?? '').trim();
    if (clave && vistos.get(clave).length > 1) {
      p.errores.push('El código ya existe en la lista: debe resolverse antes de exportar.');
    }
  }
}

/* ---------- Renderizado de la tabla ---------- */

function renderTabla() {
  marcarDuplicados();
  const tbody = $('#tabla-productos');
  const vacia = $('#tabla-vacia');
  tbody.innerHTML = '';

  if (productos.length === 0) {
    vacia.hidden = false;
  } else {
    vacia.hidden = true;
  }

  for (const p of productos) {
    const tr = document.createElement('tr');
    tr.dataset.testid = `row-producto-${p.id}`;
    if (p.errores.length > 0) tr.classList.add('con-error');

    const check = document.createElement('td');
    check.innerHTML = `<input type="checkbox" data-id="${p.id}" ${seleccion.has(p.id) ? 'checked' : ''} aria-label="Seleccionar ${p.codigo}" />`;
    check.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) seleccion.add(p.id);
      else seleccion.delete(p.id);
      actualizarVistaPrevia();
    });

    const celdas = [
      `<td class="mono">${escapeHtml(p.codigo)}</td>`,
      `<td>${escapeHtml(p.nombre)}</td>`,
      `<td class="col-num mono">${escapeHtml(fmtCOP.format(Number(p.precio_anterior) || 0))}</td>`,
      `<td class="col-num mono">${descuentoDe(p) > 0 ? descuentoDe(p) + '%' : '—'}</td>`,
      `<td class="col-num mono precio-actual ${descuentoDe(p) > 0 ? 'precio-promo' : ''}">${escapeHtml(fmtCOP.format(precioActual(p)))}</td>`,
      `<td>${p.errores.length === 0
        ? '<span class="badge badge-ok">Válido</span>'
        : `<span class="badge badge-error" title="${escapeHtml(p.errores.join(' '))}">${p.errores.length} error(es)</span>`}</td>`,
      `<td class="acciones">
         <button type="button" class="btn-icon" data-accion="editar" data-id="${p.id}">Editar</button>
         <button type="button" class="btn-icon" data-accion="eliminar" data-id="${p.id}">Eliminar</button>
       </td>`,
    ];

    tr.appendChild(check);
    for (const html of celdas) tr.insertAdjacentHTML('beforeend', html);
    tbody.appendChild(tr);
  }

  $('#contador-productos').textContent =
    `${productos.length} producto(s) en la lista · ${seleccion.size} seleccionado(s) · límite: ${LIMITE_PRODUCTOS}`;

  $('#check-todos').checked = productos.length > 0 && seleccion.size === productos.length;

  marcarDuplicados();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&' + 'amp;', '<': '&' + 'lt;', '>': '&' + 'gt;',
    '"': '&' + 'quot;', "'": '&' + '#39;',
  }[c]));
}

/* ---------- Registro manual ---------- */

$('#form-producto').addEventListener('submit', (e) => {
  e.preventDefault();
  const errBox = $('#form-error');
  errBox.hidden = true;

  const p = {
    codigo: $('#f-codigo').value.trim(),
    nombre: $('#f-nombre').value.trim(),
    precio_anterior: $('#f-precio').value.trim(),
    descuento_porcentaje: $('#f-descuento').value.trim(),
  };

  const errores = validarProducto(p);
  if (errores.length > 0) {
    errBox.textContent = errores.join(' ');
    errBox.hidden = false;
    return;
  }

  if (productos.length >= LIMITE_PRODUCTOS) {
    errBox.textContent = `Se alcanzó el límite de ${LIMITE_PRODUCTOS} productos.`;
    errBox.hidden = false;
    return;
  }

  productos.push({ id: contadorId++, origen: 'manual', errores: [], ...p });
  marcarDuplicados();
  renderTabla();
  actualizarVistaPrevia();
  e.target.reset();
  $('#f-codigo').focus();
});

/* Delegación de acciones de la tabla (editar / eliminar) */
$('#tabla-productos').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-accion]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const idx = productos.findIndex((p) => p.id === id);
  if (idx < 0) return;

  if (btn.dataset.accion === 'eliminar') {
    productos.splice(idx, 1);
    seleccion.delete(id);
    marcarDuplicados();
    renderTabla();
    actualizarVistaPrevia();
    toast('Producto eliminado.');
  } else if (btn.dataset.accion === 'editar') {
    activarEdicion(id);
  }
});

/* Edición en línea de una fila */
function activarEdicion(id) {
  const tr = $(`#tabla-productos tr[data-testid="row-producto-${id}"]`);
  const p = productos.find((x) => x.id === id);
  if (!tr || !p) return;

  const valores = {
    codigo: p.codigo, nombre: p.nombre,
    precio_anterior: p.precio_anterior, descuento_porcentaje: p.descuento_porcentaje,
  };

  tr.innerHTML = `
    <td class="celda-edit"><input data-campo="codigo" value="${escapeHtml(valores.codigo)}" aria-label="Código" /></td>
    <td class="celda-edit"><input data-campo="nombre" value="${escapeHtml(valores.nombre)}" aria-label="Nombre" /></td>
    <td class="celda-edit"><input data-campo="precio_anterior" value="${escapeHtml(valores.precio_anterior)}" aria-label="Precio anterior" /></td>
    <td class="celda-edit"><input data-campo="descuento_porcentaje" value="${escapeHtml(valores.descuento_porcentaje)}" aria-label="Descuento" /></td>
    <td class="col-num mono">${escapeHtml(fmtCOP.format(precioActual(p)))}</td>
    <td>${p.errores.length === 0
      ? '<span class="badge badge-ok">Válido</span>'
      : `<span class="badge badge-error">${p.errores.length} error(es)</span>`}</td>
    <td class="acciones">
      <button type="button" class="btn-icon" data-accion="guardar" data-id="${id}">Guardar</button>
      <button type="button" class="btn-icon" data-accion="cancelar">Cancelar</button>
    </td>`;

  tr.querySelector('input[data-campo="codigo"]').focus();

  tr.querySelector('[data-accion="guardar"]').addEventListener('click', () => {
    p.codigo = tr.querySelector('[data-campo="codigo"]').value.trim();
    p.nombre = tr.querySelector('[data-campo="nombre"]').value.trim();
    p.precio_anterior = tr.querySelector('[data-campo="precio_anterior"]').value.trim();
    p.descuento_porcentaje = tr.querySelector('[data-campo="descuento_porcentaje"]').value.trim();
    p.errores = validarProducto(p);
    marcarDuplicados();
    renderTabla();
    actualizarVistaPrevia();
    if (p.errores.length > 0) toast('El producto quedó con errores: ' + p.errores.join(' '));
    else toast('Producto actualizado.');
  });

  tr.querySelector('[data-accion="cancelar"]').addEventListener('click', () => {
    renderTabla();
  });
}

/* Selección global */
$('#check-todos').addEventListener('change', (e) => {
  seleccion = e.target.checked ? new Set(productos.map((p) => p.id)) : new Set();
  renderTabla();
  actualizarVistaPrevia();
});

/* ---------- Importación (pipeline común) ---------- */

/**
 * Convierte filas crudas (arreglos de objetos con las columnas admitidas)
 * en productos, validando cada fila y respetando los límites.
 */
function incorporarFilas(filas, origenArchivo, nombreArchivo) {
  const detalleErrores = [];
  const nuevas = [];
  let rechazadasLimite = 0;

  for (let i = 0; i < filas.length; i++) {
    if (productos.length + nuevas.length >= LIMITE_PRODUCTOS) {
      rechazadasLimite++;
      continue;
    }
    const errores = validarProducto(filas[i]);
    if (errores.length > 0) {
      detalleErrores.push({ fila: i + 1, motivo: errores.join(' ') });
    }
    // Las filas con errores también se incorporan, marcadas, para poder corregirlas.
    nuevas.push({ id: contadorId++, origen: origenArchivo, errores, ...filas[i] });
  }

  productos.push(...nuevas);
  marcarDuplicados();
  renderTabla();
  actualizarVistaPrevia();

  const validas = nuevas.filter((p) => p.errores.length === 0).length;
  mostrarReporteImportacion({
    archivo: nombreArchivo,
    leidas: filas.length,
    incorporadas: nuevas.length,
    validas,
    conErrores: nuevas.filter((p) => p.errores.length > 0).length,
    rechazadas: rechazadasLimite,
    detalle: detalleErrores,
  });
}

function mostrarReporteImportacion(r) {
  const caja = $('#import-report');
  caja.hidden = false;
  $('#import-report-titulo').textContent = `Resultado de la importación: ${r.archivo}`;
  $('#import-report-detalle').innerHTML = `
    <p class="detalle-lista">
      Filas leídas: ${r.leidas} · incorporadas: ${r.incorporadas} · válidas: ${r.validas} ·
      con errores: ${r.conErrores} · rechazadas por límite: ${r.rechazadas}.
      Las filas con errores quedan marcadas en la tabla y pueden corregirse con «Editar».
    </p>
    ${r.detalle.length > 0 ? `
      <div class="tabla-wrap">
        <table class="tabla">
          <thead><tr><th>Fila</th><th>Motivo del rechazo</th></tr></thead>
          <tbody>${r.detalle.map((d) => `<tr><td class="mono">${d.fila}</td><td>${escapeHtml(d.motivo)}</td></tr>`).join('')}</tbody>
        </table>
      </div>` : ''}
  `;
}

function validarArchivo(file) {
  if (file.size > LIMITE_ARCHIVO_MB * 1024 * 1024) {
    toast(`El archivo supera el límite de ${LIMITE_ARCHIVO_MB} MB.`);
    return false;
  }
  return true;
}

/* ---------- Importación desde Excel ---------- */

$('#input-excel').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !validarArchivo(file)) return;

  try {
    const buffer = await file.arrayBuffer();
    const libro = XLSX.read(buffer, { type: 'array' });
    const hoja = libro.Sheets[libro.SheetNames[0]]; // primera hoja del libro
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '', raw: false });

    if (filas.length === 0) {
      toast('El archivo no contiene filas de datos.');
      return;
    }

    const normalizadas = filas.map((fila) => {
      const salida = {};
      for (const [clave, valor] of Object.entries(fila)) {
        const col = normalizarEncabezado(clave);
        if (COLUMNAS_ADMITIDAS.includes(col)) salida[col] = String(valor ?? '').trim();
      }
      return salida;
    });

    const faltantes = COLUMNAS_OBLIGATORIAS.filter(
      (c) => !normalizadas.some((f) => f[c] !== undefined && f[c] !== '')
    );
    // Las columnas obligatorias deben existir en al menos una fila.
    if (faltantes.length === COLUMNAS_OBLIGATORIAS.length) {
      toast('El archivo no tiene las columnas requeridas: codigo, nombre, precio_anterior.');
      return;
    }

    incorporarFilas(normalizadas, 'Excel', file.name);
  } catch (err) {
    console.error(err);
    toast('No fue posible leer el archivo Excel. Verifique que sea .xlsx.');
  }
});

/* ---------- Importación desde PDF ---------- */

/**
 * Extrae las filas de un PDF con la plantilla tabular del proyecto
 * (texto seleccionable, encabezados: codigo, nombre, precio_anterior,
 * descuento_porcentaje). El resultado siempre se muestra para revisión.
 */
async function extraerFilasDePDF(buffer) {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const filas = [];
  let encabezados = null;

  for (let nPag = 1; nPag <= pdf.numPages; nPag++) {
    const pagina = await pdf.getPage(nPag);
    const contenido = await pagina.getTextContent();
    // Agrupar fragmentos de texto por coordenada vertical (fila) y ordenar por X (columna)
    const grupos = new Map();
    for (const item of contenido.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 3) * 3; // tolerancia de agrupación
      const x = item.transform[4];
      if (!grupos.has(y)) grupos.set(y, []);
      grupos.get(y).push({ x, texto: item.str.trim() });
    }
    const filasPagina = [...grupos.entries()]
      .sort((a, b) => b[0] - a[0]) // de arriba hacia abajo
      .map(([, celdas]) => celdas.sort((a, b) => a.x - b.x).map((c) => c.texto));

    for (const celdas of filasPagina) {
      if (celdas.some((c) => normalizarEncabezado(c) === 'codigo') &&
          celdas.some((c) => normalizarEncabezado(c) === 'nombre')) {
        encabezados = celdas.map(normalizarEncabezado);
        continue;
      }
      if (encabezados && celdas.length >= 3) {
        const fila = {};
        encabezados.forEach((col, i) => {
          if (COLUMNAS_ADMITIDAS.includes(col)) fila[col] = celdas[i] ?? '';
        });
        // El nombre puede quedar dividido en varias columnas si el PDF tiene
        // coordenadas X distintas; se unen las celdas sobrantes al nombre.
        if (celdas.length > encabezados.length && fila.nombre !== undefined) {
          fila.nombre += ' ' + celdas.slice(encabezados.length).join(' ');
        }
        if (fila.codigo !== undefined) filas.push(fila);
      }
    }
  }
  return filas;
}

$('#input-pdf').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !validarArchivo(file)) return;

  try {
    const buffer = await file.arrayBuffer();
    const filas = await extraerFilasDePDF(new Uint8Array(buffer));
    if (filas.length === 0) {
      toast('No se encontraron datos en el PDF. Solo se admite la plantilla tabular del proyecto.');
      return;
    }
    incorporarFilas(filas, 'PDF', file.name);
  } catch (err) {
    console.error(err);
    toast('No fue posible leer el PDF. Debe tener texto seleccionable.');
  }
});

/* ---------- Plantillas y datos de ejemplo ---------- */

/** Descarga la plantilla Excel con encabezados y filas de ejemplo. */
$('#btn-plantilla').addEventListener('click', () => {
  const datos = [
    { codigo: '001', nombre: 'Arroz Roa 500 g', precio_anterior: 2500, descuento_porcentaje: 10 },
    { codigo: '002', nombre: 'Aceite Girasol 1 L', precio_anterior: 8900, descuento_porcentaje: '' },
    { codigo: '003', nombre: 'Panela redonda 500 g', precio_anterior: 3200, descuento_porcentaje: 15 },
  ];
  const hoja = XLSX.utils.json_to_sheet(datos, { header: COLUMNAS_ADMITIDAS });
  hoja['!cols'] = [{ wch: 10 }, { wch: 32 }, { wch: 16 }, { wch: 20 }];
  const libro = XSLXSafe(hoja);
  XLSX.writeFile(libro, 'plantilla-productos.xlsx');
  toast('Plantilla Excel descargada.');
});

function XSLXSafe(hoja) {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'productos');
  return libro;
}

/** Genera y descarga un PDF de muestra con la plantilla tabular admitida. */
$('#btn-plantilla-pdf').addEventListener('click', async () => {
  const { PDFDocument, StandardFonts } = PDFLib;
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const pagina = doc.addPage([mmAPt(210), mmAPt(297)]);
  const y0 = mmAPt(280);

  const columnas = [
    { titulo: 'codigo', x: mmAPt(15) },
    { titulo: 'nombre', x: mmAPt(45) },
    { titulo: 'precio_anterior', x: mmAPt(125) },
    { titulo: 'descuento_porcentaje', x: mmAPt(160) },
  ];
  const filas = [
    ['0100', 'Café mezcla 250 g', '4500', '20'],
    ['0101', 'Leche entera 1 L', '3900', ''],
    ['0102', 'Azúcar morena 500 g', '2800', '5'],
    ['0103', 'Frijol cargamanto 500 g', '6200', '12.5'],
  ];

  let y = y0;
  pagina.drawText('Plantilla tabular del proyecto — etiquetas de precios', { x: mmAPt(15), y: y + 10, size: 10, font: fuente });
  columnas.forEach((c) => pagina.drawText(c.titulo, { x: c.x, y, size: 9, font: fuente }));
  y -= 14;
  for (const fila of filas) {
    fila.forEach((celda, i) => pagina.drawText(String(celda), { x: columnas[i].x, y, size: 9, font: fuente }));
    y -= 14;
  }

  const bytes = await doc.save();
  descargarBlob(new Blob([bytes], { type: 'application/pdf' }), 'plantilla-productos.pdf');
  toast('PDF de muestra descargado. Puede importarlo con el botón «Importar PDF».');
});

/** Carga un conjunto de datos de ejemplo para probar la aplicación. */
$('#btn-ejemplos').addEventListener('click', () => {
  if (productos.length > 0 && !confirm('¿Reemplazar la lista actual por los datos de ejemplo?')) return;
  productos = [];
  seleccion = new Set();
  const ejemplos = [
    { codigo: '001', nombre: 'Arroz Roa 500 g', precio_anterior: '2500', descuento_porcentaje: '10' },
    { codigo: '002', nombre: 'Aceite Girasol 1 L', precio_anterior: '8900', descuento_porcentaje: '' },
    { codigo: '003', nombre: 'Panela redonda 500 g', precio_anterior: '3200', descuento_porcentaje: '15' },
    { codigo: '004', nombre: 'Café mezcla 250 g', precio_anterior: '4500', descuento_porcentaje: '20' },
    { codigo: '005', nombre: 'Leche entera 1 L', precio_anterior: '3900', descuento_porcentaje: '' },
    { codigo: '006', nombre: 'Lentejas 500 g', precio_anterior: '4100', descuento_porcentaje: '8' },
    { codigo: '007', nombre: 'Harina de trigo 1 kg', precio_anterior: '5200', descuento_porcentaje: '0' },
    { codigo: '008', nombre: 'Sal refinada 500 g', precio_anterior: '1300', descuento_porcentaje: '25' },
  ];
  incorporarFilas(ejemplos, 'ejemplo', 'datos de ejemplo');
  seleccion = new Set(productos.map((p) => p.id));
  renderTabla();
  actualizarVistaPrevia();
  toast('Datos de ejemplo cargados y seleccionados.');
});

/* ---------- Configuración de etiquetas ---------- */

function configActual() {
  return {
    tamano: document.querySelector('input[name="tamano"]:checked').value,
    diseno: document.querySelector('input[name="diseno"]:checked').value,
  };
}

document.querySelectorAll('input[name="tamano"], input[name="diseno"]').forEach((input) => {
  input.addEventListener('change', actualizarVistaPrevia);
});

/* ---------- Vista previa ---------- */

function productosSeleccionados() {
  return productos.filter((p) => seleccion.has(p.id));
}

function actualizarVistaPrevia() {
  const { tamano } = configActual();
  const sel = productosSeleccionados();
  const contenedor = $('#preview-hoja');
  const vacia = $('#preview-vacia');

  if (sel.length === 0) {
    contenedor.hidden = true;
    vacia.hidden = false;
    $('#preview-info').textContent = '';
    return;
  }

  vacia.hidden = true;
  contenedor.hidden = false;

  const t = TAMANOS[tamano];
  const cols = Math.floor((210 - 2 * MARGEN_MM + SEPARACION_MM) / (t.ancho + SEPARACION_MM));
  const filas = Math.floor((297 - 2 * MARGEN_MM + SEPARACION_MM) / (t.alto + SEPARACION_MM));

  // Escala para mostrar la hoja completa en pantalla
  const anchoContenedor = $('#preview-wrap').clientWidth - 2 * 16;
  const anchoHojaPx = mmAPt(210) * (96 / 72); // ancho de la hoja en píxeles CSS
  const escala = Math.min(1, anchoContenedor / anchoHojaPx);
  const pxPorMm = (mmAPt(1) * escala) * (96 / 72);

  contenedor.style.width = `${210 * pxPorMm}px`;
  contenedor.style.height = `${297 * pxPorMm}px`;

  contenedor.innerHTML = '';
  let idx = 0;
  for (let fila = 0; fila < filas && idx < sel.length; fila++) {
    for (let col = 0; col < cols && idx < sel.length; col++) {
      const p = sel[idx++];
      const div = document.createElement('div');
      div.className = 'etiqueta' +
        (configActual().diseno === 'personalizado' ? ' etq-personalizada' : '');
      div.dataset.testid = `preview-etiqueta-${p.id}`;
      div.style.left = `${(MARGEN_MM + col * (t.ancho + SEPARACION_MM)) * pxPorMm}px`;
      div.style.top = `${(MARGEN_MM + fila * (t.alto + SEPARACION_MM)) * pxPorMm}px`;
      div.style.width = `${t.ancho * pxPorMm}px`;
      div.style.height = `${t.alto * pxPorMm}px`;
      div.appendChild(construirContenidoEtiqueta(p, tamano));
      contenedor.appendChild(div);
    }
  }

  const total = sel.length;
  const porHoja = cols * filas;
  const hojas = Math.ceil(total / porHoja);
  $('#preview-info').textContent =
    `${total} etiqueta(s) · tamaño ${t.etiqueta} · ${cols} × ${filas} = ${porHoja} por hoja A4 · ${hojas} hoja(s). ` +
    `Se generará el diseño «${configActual().diseno}»; los productos con descuento mayor que 0% se marcan como promoción cuando el diseño lo permite.`;
}

/** Construye el contenido HTML de una etiqueta según su diseño. */
function construirContenidoEtiqueta(p, tamano) {
  const frag = document.createDocumentFragment();
  const escalaFuente = { pequeno: 0.75, mediano: 0.9, grande: 1.1 }[tamano];
  const base = { pequeno: 10, mediano: 12, grande: 14 }[tamano];

  const add = (clase, texto, tam = 1) => {
    const el = document.createElement('div');
    el.className = clase;
    el.style.fontSize = `${base * tam * escalaFuente}px`;
    el.textContent = texto;
    frag.appendChild(el);
  };

  const diseno = configActual().diseno;
  const esPromo = descuentoDe(p) > 0;

  if (diseno === 'personalizado') {
    // Diseño propio: fondo suave, arco e insignia de descuento, triángulo y precio destacado
    const cont = document.createElement('div');
    cont.className = 'etq-texto';
    const addProp = (clase, texto, tam) => {
      const el = document.createElement('div');
      el.className = clase;
      el.style.fontSize = `${base * tam * escalaFuente}px`;
      el.textContent = texto;
      cont.appendChild(el);
    };
    addProp('e-nombre-prop', p.nombre, 0.78);
    addProp('e-cod', 'Código: ' + p.codigo, 0.68);
    if (esPromo) {
      addProp('e-ant', 'Precio anterior: ' + fmtCOP.format(Number(p.precio_anterior)), 0.78);
    }
    addProp('e-ahora', (esPromo ? 'Ahora: ' : '') + fmtCOP.format(precioActual(p)), 1.0);
    frag.appendChild(cont);

    const arco = document.createElement('div');
    arco.className = 'etq-arco';
    frag.appendChild(arco);
    const tri = document.createElement('div');
    tri.className = 'etq-triangulo';
    frag.appendChild(tri);
    if (esPromo) {
      const ins = document.createElement('div');
      ins.className = 'etq-insignia';
      ins.style.fontSize = `${base * 0.62 * escalaFuente}px`;
      ins.textContent = descuentoDe(p) + '%';
      frag.appendChild(ins);
    }
    return frag;
  }

  add('e-codigo', p.codigo, 0.8);
  add('e-nombre', p.nombre, 0.85);

  if (diseno === 'promocion' && esPromo) {
    const linea = document.createElement('div');
    linea.className = 'e-linea-promo';
    const anterior = document.createElement('span');
    anterior.className = 'e-anterior';
    anterior.style.fontSize = `${base * 0.8 * escalaFuente}px`;
    anterior.textContent = fmtCOP.format(Number(p.precio_anterior));
    const actual = document.createElement('span');
    actual.className = 'e-precio';
    actual.style.fontSize = `${base * 1.1 * escalaFuente}px`;
    actual.textContent = fmtCOP.format(precioActual(p));
    linea.append(anterior, actual);
    frag.appendChild(linea);
    add('e-promo', `-${descuentoDe(p)}%`, 0.9);
  } else if (diseno === 'destacado') {
    add('e-precio', fmtCOP.format(precioActual(p)), 1.25);
  } else {
    add('e-precio', fmtCOP.format(precioActual(p)), 1);
  }
  return frag;
}

window.addEventListener('resize', actualizarVistaPrevia);

/* ---------- Generación del PDF ---------- */

$('#btn-generar').addEventListener('click', async () => {
  const sel = productosSeleccionados();
  if (sel.length === 0) {
    toast('Seleccione al menos un producto para generar las etiquetas.');
    return;
  }
  const conErrores = sel.filter((p) => p.errores.length > 0 || validarProducto(p).length > 0);
  if (conErrores.length > 0) {
    toast(`Hay ${conErrores.length} producto(s) con errores: corríjalos antes de generar el PDF.`);
    return;
  }

  try {
    const bytes = await generarPDFFEtiquetas(sel);
    descargarBlob(new Blob([bytes], { type: 'application/pdf' }), 'etiquetas-precios.pdf');
    toast('PDF generado y descargado.');
  } catch (err) {
    console.error(err);
    toast('Ocurrió un error al generar el PDF.');
  }
});

/** Construye el documento PDF con las etiquetas de los productos seleccionados. */
async function generarPDFFEtiquetas(sel) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const { tamano, diseno } = configActual();
  const t = TAMANOS[tamano];
  const anchoHoja = mmAPt(210);
  const altoHoja = mmAPt(297);
  const margen = mmAPt(MARGEN_MM);
  const separacion = mmAPt(SEPARACION_MM);
  const anchoEt = mmAPt(t.ancho);
  const altoEt = mmAPt(t.alto);

  const cols = Math.floor((anchoHoja - 2 * margen + separacion) / (anchoEt + separacion));
  const filasPorHoja = Math.floor((altoHoja - 2 * margen + separacion) / (altoEt + separacion));

  let pagina = null;
  let idx = 0;

  while (idx < sel.length) {
    pagina = doc.addPage([anchoHoja, altoHoja]);
    for (let fila = 0; fila < filasPorHoja && idx < sel.length; fila++) {
      for (let col = 0; col < cols && idx < sel.length; col++) {
        const p = sel[idx++];
        const x = margen + col * (anchoEt + separacion);
        const y = altoHoja - margen - altoEt - fila * (altoEt + separacion);
        dibujarEtiqueta(pagina, p, x, y, anchoEt, altoEt, { helvetica, helveticaBold, rgb, diseno });
      }
    }
  }
  return doc.save();
}

/** Dibuja una etiqueta individual en el PDF. */
function dibujarEtiqueta(pagina, p, x, y, ancho, alto, f) {
  const centroX = x + ancho / 2;
  const esPromo = descuentoDe(p) > 0;
  const escala = alto / mmAPt(TAMANOS[configActual().tamano].alto);
  const base = { pequeno: 7.5, mediano: 9.5, grande: 11.5 }[configActual().tamano] * escala;

  if (f.diseno === 'personalizado') {
    dibujarEtiquetaPersonalizada(pagina, p, x, y, ancho, alto, { ...f, esPromo, base, centroX });
    return;
  }

  // Borde
  pagina.drawRectangle({
    x, y, width: ancho, height: alto,
    borderColor: f.rgb(0.55, 0.53, 0.5), borderWidth: 0.75, color: f.rgb(1, 1, 1),
  });

  const textoCentrado = (texto, fuente, tam, dy, color = f.rgb(0.15, 0.14, 0.12)) => {
    const anchoTexto = fuente.widthOfTextAtSize(texto, tam);
    pagina.drawText(texto, {
      x: centroX - anchoTexto / 2, y: y + alto / 2 + dy,
      size: tam, font: fuente, color,
    });
  };

  // Código en la parte superior (siempre)
  textoCentrado(String(p.codigo), f.helvetica, base * 0.7, alto * 0.30, f.rgb(0.44, 0.42, 0.39));

  if (f.diseno === 'promocion' && esPromo) {
    // Diseño promoción: nombre, línea de precios y porcentaje
    const nombre = acortarTexto(String(p.nombre), f.helveticaBold, base * 0.8, ancho - 8);
    textoCentrado(nombre, f.helveticaBold, base * 0.8, alto * 0.12);

    const anteriorTxt = fmtCOP.format(Number(p.precio_anterior));
    const actualTxt = fmtCOP.format(precioActual(p));
    const tamAnt = base * 0.75;
    const tamAct = base * 1.15;
    const wAnt = f.helvetica.widthOfTextAtSize(anteriorTxt, tamAnt);
    const wAct = f.helveticaBold.widthOfTextAtSize(actualTxt, tamAct);
    const wTotal = wAnt + 6 + wAct;
    const yLinea = y + alto * 0.40;
    pagina.drawText(anteriorTxt, { x: centroX - wTotal / 2, y: yLinea, size: tamAnt, font: f.helvetica, color: f.rgb(0.44, 0.42, 0.39) });
    pagina.drawText(actualTxt, { x: centroX - wTotal / 2 + wAnt + 6, y: yLinea, size: tamAct, font: f.helveticaBold, color: f.rgb(0.06, 0.29, 0.2) });
    // Tachado del precio anterior
    pagina.drawLine({
      start: { x: centroX - wTotal / 2 - 1, y: yLinea + tamAnt * 0.32 },
      end: { x: centroX - wTotal / 2 + wAnt + 1, y: yLinea + tamAnt * 0.32 },
      thickness: 0.8, color: f.rgb(0.44, 0.42, 0.39),
    });
    textoCentrado('-' + descuentoDe(p) + '%', f.helveticaBold, base * 0.85, -alto * 0.20, f.rgb(0.7, 0.35, 0));
  } else {
    // Diseño básico / precio destacado (o promoción sin descuento)
    const nombre = acortarTexto(String(p.nombre), f.helveticaBold, base * 0.8, ancho - 8);
    textoCentrado(nombre, f.helveticaBold, base * 0.8, alto * 0.14);

    const tam = f.diseno === 'destacado' ? base * 1.25 : base;
    const precioTxt = acortarTexto(fmtCOP.format(precioActual(p)), f.helveticaBold, tam, ancho - 8);
    textoCentrado(precioTxt, f.helveticaBold, tam, -alto * 0.10, f.rgb(0.06, 0.29, 0.2));
  }
}

/** Divide un texto en líneas que quepan en un ancho disponible. */
function envolverTexto(texto, fuente, tam, anchoMax) {
  const palabras = String(texto).split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';
  for (const palabra of palabras) {
    const prueba = actual ? actual + ' ' + palabra : palabra;
    if (fuente.widthOfTextAtSize(prueba, tam) <= anchoMax) {
      actual = prueba;
    } else {
      if (actual) lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) lineas.push(actual);
  if (lineas.length === 0) lineas.push('');
  return lineas;
}

/**
 * Diseño personalizado: fondo lavanda con borde azul redondeado, arco amarillo
 * en la esquina superior derecha, insignia roja con el porcentaje de descuento,
 * triángulo amarillo en la esquina inferior izquierda y precio destacado en verde.
 */
function dibujarEtiquetaPersonalizada(pagina, p, x, y, ancho, alto, f) {
  const { rgb } = f;
  const yTop = y + alto; // borde superior de la etiqueta
  const rr = Math.min(ancho, alto) * 0.07;

  // Fondo redondeado lavanda con borde azul
  const rectRedondeado =
    `M ${rr} 0 H ${ancho - rr} A ${rr} ${rr} 0 0 1 ${ancho} ${rr} ` +
    `V ${alto - rr} A ${rr} ${rr} 0 0 1 ${ancho - rr} ${alto} ` +
    `H ${rr} A ${rr} ${rr} 0 0 1 0 ${alto - rr} V ${rr} A ${rr} ${rr} 0 0 1 ${rr} 0 Z`;
  pagina.drawSvgPath(rectRedondeado, {
    x, y: yTop,
    color: rgb(0.933, 0.949, 0.984),
    borderColor: rgb(0.231, 0.51, 0.965),
    borderWidth: 1.2,
  });

  const AMARILLO = rgb(0.976, 0.902, 0.659);

  // Arco amarillo: cuarto de disco anclado a la esquina superior derecha
  const rArco = alto * 0.42;
  pagina.drawSvgPath(`M 0 0 L ${-rArco} 0 A ${rArco} ${rArco} 0 0 0 0 ${rArco} Z`, {
    x: x + ancho, y: yTop, color: AMARILLO,
  });

  // Triángulo amarillo en la esquina inferior izquierda
  const tTri = alto * 0.30;
  pagina.drawSvgPath(`M 0 ${alto} L ${tTri} ${alto} L 0 ${alto - tTri} Z`, {
    x, y: yTop, color: AMARILLO,
  });

  // Insignia roja con el porcentaje de descuento
  if (f.esPromo) {
    const cx = x + ancho - alto * 0.28;
    const cy = yTop - alto * 0.28;
    pagina.drawCircle({ x: cx, y: cy, size: alto * 0.17, color: rgb(0.898, 0.224, 0.208) });
    const txtIns = `${descuentoDe(p)}%`;
    const tamIns = f.base * 0.62;
    const wIns = f.helveticaBold.widthOfTextAtSize(txtIns, tamIns);
    pagina.drawText(txtIns, {
      x: cx - wIns / 2, y: cy - tamIns * 0.36, size: tamIns,
      font: f.helveticaBold, color: rgb(1, 1, 1),
    });
  }

  // Textos
  const pad = ancho * 0.055;
  const maxNombre = ancho - 2 * pad - alto * 0.45;

  // Nombre en mayúsculas, hasta 3 líneas
  const tamNombre = f.base * 0.72;
  const lineas = envolverTexto(String(p.nombre).toUpperCase(), f.helveticaBold, tamNombre, maxNombre).slice(0, 3);
  let ty = yTop - pad - tamNombre;
  for (const linea of lineas) {
    pagina.drawText(linea, { x: x + pad, y: ty, size: tamNombre, font: f.helveticaBold, color: rgb(0.15, 0.14, 0.12) });
    ty -= tamNombre * 1.18;
  }

  // Código
  const tamCod = f.base * 0.66;
  pagina.drawText('Código: ' + p.codigo, {
    x: x + pad, y: y + alto * 0.34, size: tamCod, font: f.helvetica, color: rgb(0.29, 0.28, 0.26),
  });

  // Precio anterior tachado (solo promoción)
  if (f.esPromo) {
    const tamAnt = f.base * 0.72;
    const yAnt = y + alto * 0.22;
    const etiquetaAnt = 'Precio anterior: ';
    const wEt = f.helvetica.widthOfTextAtSize(etiquetaAnt, tamAnt);
    const precioAnt = fmtCOP.format(Number(p.precio_anterior));
    const wPr = f.helvetica.widthOfTextAtSize(precioAnt, tamAnt);
    pagina.drawText(etiquetaAnt + precioAnt, {
      x: x + pad, y: yAnt, size: tamAnt, font: f.helvetica, color: rgb(0.44, 0.42, 0.39),
    });
    pagina.drawLine({
      start: { x: x + pad + wEt, y: yAnt + tamAnt * 0.3 },
      end: { x: x + pad + wEt + wPr, y: yAnt + tamAnt * 0.3 },
      thickness: 0.8, color: rgb(0.44, 0.42, 0.39),
    });
  }

  // Precio actual destacado en verde, centrado
  const tamAhora = f.base * 1.0;
  const textoAhora = (f.esPromo ? 'Ahora: ' : '') + fmtCOP.format(precioActual(p));
  const wAhora = f.helveticaBold.widthOfTextAtSize(textoAhora, tamAhora);
  pagina.drawText(textoAhora, {
    x: f.centroX - wAhora / 2, y: y + alto * 0.055, size: tamAhora,
    font: f.helveticaBold, color: rgb(0.10, 0.50, 0.22),
  });
}

/** Recorta un texto para que quepa en un ancho disponible (con puntos suspensivos). */
function acortarTexto(texto, fuente, tam, anchoMax) {
  if (fuente.widthOfTextAtSize(texto, tam) <= anchoMax) return texto;
  let corto = texto;
  while (corto.length > 1 && fuente.widthOfTextAtSize(corto + '…', tam) > anchoMax) {
    corto = corto.slice(0, -1);
  }
  return corto + '…';
}

/* ---------- Descarga de archivos ---------- */

function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- Inicio ---------- */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

renderTabla();
actualizarVistaPrevia();
