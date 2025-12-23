/**
 * ======================================================================
 * CONSTANTES GLOBALES
 * ======================================================================
 */

// Usado por la validación de Token
const TOKEN_SHEET_NAME = 'tbl_relaciones'; 
const TOKEN_COLUMN_NAME = 'Token Key';      

// Usado por handleUpdate
const UPDATE_SHEET_NAME = 'BD_FACT'; 

// Usados por handleDownloadReport y handlePrintFact
const SHEET_CLIENTES = 'BD_PX';
const SHEET_FACTURAS = 'BD_FACT';       
const SHEET_DETALLES = 'BD_FACT_DETAIL'; 

// Usado solo por handlePrintFact y la lógica de parámetros
const SHEET_MAESTRO_PRODUCTOS = 'tbl_estudios';

// --- NUEVAS CONSTANTES PARA LA LÓGICA DE PARÁMETROS Y REPORTE ---
const SHEET_PARAMETROS = 'tbl_parametro';
const SHEET_RESULTADOS = 'BD_RESULTADOS';
const SHEET_GRUPOS = 'tbl_grupo_estudio';
const SHEET_FAMILIAS = 'tbl_familia'; // Agregada para el reporte


/**
 * ======================================================================
 * FUNCIÓN PRINCIPAL (EL ENRUTADOR)
 * ======================================================================
 */
function doGet(e) {
  // --- 1. Extraer parámetros COMUNES ---
  const idgs = e.parameter.idgs;
  const accion = e.parameter.accion;
  const token = e.parameter.token;
  const loadParam = e.parameter['load-param']; // Captura el disparador de parámetros

  // --- 2. Validaciones Principales ---
  if (!idgs) {
    return ContentService.createTextOutput('Error: Falta el parámetro "idgs" (ID del Google Sheet).');
  }
  if (!accion && !loadParam) {
    return ContentService.createTextOutput('Error: Falta el parámetro "accion" o "load-param".');
  }

  // Nota: Para "printresult" permitimos acceso público (como solicitaste para el PDF)
  // o si prefieres seguridad, descomenta la validación de token para todos.
  // Aquí mantengo la lógica original: si hay token, validamos. 
  // Si la acción es publica, podriamos saltar esto, pero por seguridad general lo dejo activo
  // a menos que sea una acción que explícitamente quieras pública.
  
  /* 
   * IMPORTANTE: Si AppSheet no envía el token en el enlace del PDF, 
   * esta validación fallará. Si el PDF es público, puedes agregar 
   * "&& accion !== 'printresult'" en el if de abajo.
   */
  if (!token && accion !== 'printresult') { 
    return createJsonResponse({ 
      status: 'error', 
      message: 'Acceso denegado: Falta el parámetro "token".' 
    });
  }

   try {
    const spreadsheet = SpreadsheetApp.openById(idgs);

    if (token && !isTokenValid(spreadsheet, token)) {
       return createJsonResponse({ 
        status: 'error', 
        message: 'Acceso denegado: Token no válido.' 
      });
    }

    // --- 3. ENRUTAMIENTO ---

    // NUEVO: Caso para la WebApp de carga de parámetros
    if (loadParam) {
      return handleLoadParametersUI(e);
    }

    const accionLower = accion.toLowerCase();

    if (accionLower === 'consulta') {
      return handleQuery(e, spreadsheet);
      
    } else if (accionLower === 'actualizacion') {
      return handleUpdate(e, spreadsheet);
      
    } else if (accionLower === 'download_report') {
      return handleDownloadReport(e, spreadsheet);

    } else if (accionLower === 'print_fact') {
      return handlePrintFact(e, spreadsheet);

    } else if (accionLower === 'printresult') {
      // --- NUEVO CASO INTEGRADO: IMPRESIÓN DE RESULTADOS ---
      return handlePrintResult(e, spreadsheet);

    } else {
      return createJsonResponse({ 
        status: 'error', 
        message: 'Acción no válida. Use "consulta", "actualizacion", "download_report", "print_fact", "printresult" o use "load-param".' 
      });
    }

  } catch (error) {
    Logger.log(error);
    const accionLower = accion ? accion.toLowerCase() : "";
    if (accionLower === 'consulta') {
      return ContentService.createTextOutput(`Error en el servidor: ${error.message}`);
    } else if (accionLower === 'download_report' || accionLower === 'print_fact' || accionLower === 'printresult' || loadParam) {
      return HtmlService.createHtmlOutput(`<h1>Error en el servidor: ${error.message}</h1>`);
    } else {
      return createJsonResponse({
        status: 'error',
        message: `Ha ocurrido un error principal en el servidor: ${error.message}`
      });
    }
  }
}

/**
 * ======================================================================
 * NUEVA LÓGICA: CARGA DE PARÁMETROS Y PERFILES (WebApp)
 * ======================================================================
 */

// Llama a la interfaz inicial (Spinner)
function handleLoadParametersUI(e) {
  const tmp = HtmlService.createTemplateFromFile('index');
  tmp.modo = e.parameter['modo'] || "particular";
  tmp.idFactEstudio = e.parameter['id-fact-estudio'] || "";
  tmp.idEstudio = e.parameter['id-estudio'] || "";
  tmp.idFact = e.parameter['id-fact'] || "";
  tmp.idgs = e.parameter['idgs']; // Pasamos el ID para que el proceso sepa qué archivo abrir
  
  return tmp.evaluate()
    .setTitle('Procesando Parámetros del Estudio')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Función que ejecuta la inserción masiva (Invocada desde index.html)
function ejecutarProceso(params) {
  try {
    const ss = SpreadsheetApp.openById(params.idgs);
    const sheetFactDetail = ss.getSheetByName(SHEET_DETALLES);
    const sheetParametros = ss.getSheetByName(SHEET_PARAMETROS);
    const sheetResultados = ss.getSheetByName(SHEET_RESULTADOS);
    const sheetEstudios = ss.getSheetByName(SHEET_MAESTRO_PRODUCTOS);
    const sheetGrupos = ss.getSheetByName(SHEET_GRUPOS);

    // 1. Cargar Catálogo de Estudios 
    const dataEst = sheetEstudios.getDataRange().getValues();
    const headEst = dataEst.shift();
    const dictEstudios = {}; // <--- AQUÍ SE DECLARA
    dataEst.forEach(r => {
      dictEstudios[r[headEst.indexOf('id-estudio')]] = {
        nombre: r[headEst.indexOf('description-estudio')],
        esPerfil: String(r[headEst.indexOf('perfil')]).toUpperCase() === "TRUE"
      };
    });

    // 2. Cargar Resultados existentes para evitar duplicados
    const dataExistente = sheetResultados.getDataRange().getValues();
    const colIdFactEstudioRes = dataExistente[0].indexOf('id-fact-estudio');
    const idsYaCargados = new Set(dataExistente.map(fila => fila[colIdFactEstudioRes].toString()));

    // 3. Identificar estudios de la factura
    const dataFact = sheetFactDetail.getDataRange().getValues();
    const headFact = dataFact.shift();
    let candidatos = [];

    if (params.modo === "particular") {
      const row = dataFact.find(r => r[headFact.indexOf('id-fact-estudio')] == params.idFactEstudio);
      if (row) candidatos.push({
        idFactEstudio: params.idFactEstudio.toString(),
        idEstudioOriginal: params.idEstudio,
        idFact: row[headFact.indexOf('id-fact')],
        idEmpresa: row[headFact.indexOf('ID_Empresa')]
      });
    } else {
      const filas = dataFact.filter(r => r[headFact.indexOf('id-fact')] == params.idFact);
      filas.forEach(r => candidatos.push({
        idFactEstudio: r[headFact.indexOf('id-fact-estudio')].toString(),
        idEstudioOriginal: r[headFact.indexOf('id-estudio')],
        idFact: r[headFact.indexOf('id-fact')],
        idEmpresa: r[headFact.indexOf('ID_Empresa')]
      }));
    }

    // Filtrar los que no están cargados
    const estudiosAProcesar = candidatos.filter(c => !idsYaCargados.has(c.idFactEstudio));

    if (estudiosAProcesar.length === 0) {
      return { success: true, estudios: ["Aviso: Los estudios ya estaban cargados previamente."], modo: params.modo };
    }

    const dataGrupos = sheetGrupos.getDataRange().getValues();
    const headGrup = dataGrupos.shift();
    const dataParams = sheetParametros.getDataRange().getValues();
    const headParam = dataParams.shift();

    const nuevosRegistros = [];
    const nombresProcesados = [];
    const fechaActual = new Date();

    // 4. Mapear Parámetros
    estudiosAProcesar.forEach(item => {
      const infoEst = dictEstudios[item.idEstudioOriginal]; 
      
      if (!infoEst) return;
      nombresProcesados.push(infoEst.nombre);

      // Si es perfil, buscamos los hijos
      let idsEstudiosFinales = infoEst.esPerfil 
        ? dataGrupos.filter(g => g[headGrup.indexOf('id_perfil')] == item.idEstudioOriginal).map(g => g[headGrup.indexOf('id_Estudio')])
        : [item.idEstudioOriginal];

      idsEstudiosFinales.forEach(idHijo => {
        const paramsEncontrados = dataParams.filter(p => p[headParam.indexOf('id-estudio')] == idHijo);
        paramsEncontrados.forEach(p => {
          nuevosRegistros.push([
            generarIDUnico(6),                              // id-result
            item.idFactEstudio,                             // id-fact-estudio
            item.idFact,                                    // id-fact
            item.idEstudioOriginal,                         // id-estudio (Mantenemos el ID del Perfil/Padre)
            p[headParam.indexOf('id-parameter')],           // id-parameter
            p[headParam.indexOf('unit-parameter')],         // unit-parameter
            "", "",                                         // cuantitativo / cualitativo
            p[headParam.indexOf('type-parameter')],         // type-parameter
            p[headParam.indexOf('min-parameter')],          // min-parameter
            p[headParam.indexOf('max-parameter')],          // max-parameter
            p[headParam.indexOf('ref-descrip-parameter')],  // ref-descrip-parameter
            p[headParam.indexOf('obs-parameter')],          // obs-parameter
            "",                                             // image-result
            fechaActual,                                    // datetime-lastupdate
            "",                                             // user-lastupdate
            item.idEmpresa                                  // ID_Empresa
          ]);
        });
      });
    });

    if (nuevosRegistros.length > 0) {
      sheetResultados.getRange(sheetResultados.getLastRow() + 1, 1, nuevosRegistros.length, nuevosRegistros[0].length).setValues(nuevosRegistros);
    } else {
      throw new Error("No se encontraron parámetros para procesar.");
    }

    return { success: true, estudios: nombresProcesados, modo: params.modo };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function generarIDUnico(length) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * ======================================================================
 * MANEJADOR NUEVO: IMPRESIÓN DE RESULTADOS (PDF)
 * ======================================================================
 */
function handlePrintResult(e, spreadsheet) {
  const params = e.parameter;
  const idFact = params['id-fact'];

  // Parámetros de estilo (opcionales)
  const imgUrl = params.url_img || "https://i.imgur.com/QgMqAU0.jpeg"; 
  const headerBgColor = params.col_bg || "#00b0f0"; 
  const headerTxtColor = params.col_txt || "#ffffff"; 
  const signUrl = params.url_firma || ""; 

  if (!idFact) return HtmlService.createHtmlOutput("Error: Falta el parámetro 'id-fact'.");

  // Llamada a la función de recolección de datos
  const data = getMedicalReportData(spreadsheet, idFact);

  if (!data) return HtmlService.createHtmlOutput("No se encontraron datos para esta factura o paciente.");

  // Configuración del nombre del archivo
  // Formato: 'id-service' 'dni-px' 'name-px' 'lastname-px'
  const nombreArchivo = data.factura['id-service'] + " " + 
                      data.paciente['dni-px'] + " " + 
                      data.paciente['name-px'] + " " + 
                      data.paciente['lastname-px'];

  const template = HtmlService.createTemplateFromFile('Report');
  template.data = data;
  template.style = {
    imgUrl: imgUrl,
    headerBgColor: headerBgColor,
    headerTxtColor: headerTxtColor,
    signUrl: signUrl
  };
  
  return template.evaluate()
      .setTitle(nombreArchivo)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * ======================================================================
 * LÓGICA ORIGINAL DE TU API (Sin cambios)
 * ======================================================================
 */

function isTokenValid(spreadsheet, token) {
  try {
    const sheet = spreadsheet.getSheetByName(TOKEN_SHEET_NAME);
    if (!sheet) {
      Logger.log(`Error de seguridad: La hoja de tokens "${TOKEN_SHEET_NAME}" no fue encontrada.`);
      return false;
    }
    const data = sheet.getDataRange().getValues();
    const headers = data.shift();
    const tokenColumnIndex = headers.indexOf(TOKEN_COLUMN_NAME);
    if (tokenColumnIndex === -1) {
      Logger.log(`Error de seguridad: La columna "${TOKEN_COLUMN_NAME}" no fue encontrada.`);
      return false;
    }
    for (const row of data) {
      if (row[tokenColumnIndex] && row[tokenColumnIndex] == token) return true;
    }
    return false;
  } catch (error) {
    Logger.log(`Error durante la validación del token: ${error.message}`);
    return false;
  }
}

function handleQuery(e, spreadsheet) {
  const sheetName = e.parameter.sheet;
  if (!sheetName) return ContentService.createTextOutput('Error: Falta el parámetro "sheet" para la consulta.');
  const sourceSheet = spreadsheet.getSheetByName(sheetName);
  if (!sourceSheet) return ContentService.createTextOutput(`Error: No se encontró la hoja "${sheetName}".`);
  const allData = sourceSheet.getDataRange().getValues();
  if (!allData || allData.length === 0) return ContentService.createTextOutput(`Error: La hoja "${sheetName}" está vacía.`);
  const csvData = arrayToCsv(allData);
  return ContentService.createTextOutput(csvData).setMimeType(ContentService.MimeType.CSV).downloadAsFile(`${sheetName}.csv`);
}

function handleUpdate(e, spreadsheet) {
  const idvnt = e.parameter.idvnt;
  const service = e.parameter.service;
  const convenio = e.parameter.convenio;

  if (!idvnt || !service || !convenio) {
    return createJsonResponse({ status: 'error', message: 'Faltan parámetros idvnt, service y convenio.' });
  }
  
  const sheet = spreadsheet.getSheetByName(UPDATE_SHEET_NAME);
  if (!sheet) return createJsonResponse({ status: 'error', message: `No se encontró la hoja "${UPDATE_SHEET_NAME}".` });

  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  const colIndex = {
    idFact: headers.indexOf('id-fact'),
    idService: headers.indexOf('id-service'),
    idConvenio: headers.indexOf('id-convenio'),
    lastUpdate: headers.indexOf('datetime-lastupdate')
  };

  if (Object.values(colIndex).some(index => index === -1)) {
    return createJsonResponse({ status: 'error', message: 'Columnas requeridas no encontradas.' });
  }

  for (let i = 0; i < data.length; i++) {
    if (data[i][colIndex.idFact] == idvnt) {
      const rowNumber = i + 2;
      const timestamp = new Date();
      sheet.getRange(rowNumber, colIndex.idService + 1).setValue(service);
      sheet.getRange(rowNumber, colIndex.idConvenio + 1).setValue(convenio);
      sheet.getRange(rowNumber, colIndex.lastUpdate + 1).setValue(timestamp);
      return createJsonResponse({ status: 'success', message: `ID ${idvnt} actualizado.` });
    }
  }
  return createJsonResponse({ status: 'error', message: `ID ${idvnt} no encontrado.` });
}

function handleDownloadReport(e, sourceSpreadsheet) {
  let tempSpreadsheet = null;
  try {
    const clientesData = getSheetDataAsMap(sourceSpreadsheet.getSheetByName(SHEET_CLIENTES), 'id-px');
    const facturasData = getSheetData(sourceSpreadsheet.getSheetByName(SHEET_FACTURAS));
    const detallesData = getSheetDataAsGroupedMap(sourceSpreadsheet.getSheetByName(SHEET_DETALLES), 'id-fact');
    
    const finalData = combineData(clientesData, facturasData, detallesData);
    if (finalData.length <= 1) return HtmlService.createHtmlOutput('<h1>No hay datos para combinar.</h1>');

    tempSpreadsheet = SpreadsheetApp.create('bd_servicios_temp');
    const tempSheet = tempSpreadsheet.getSheets()[0];
    tempSheet.getRange(1, 1, finalData.length, finalData[0].length).setValues(finalData);

    const downloadUrl = `https://docs.google.com/spreadsheets/d/${tempSpreadsheet.getId()}/export?format=xlsx`;
    return HtmlService.createHtmlOutput(`<script>window.location.href = "${downloadUrl}";</script><p>Descargando...</p>`);
  } catch (error) {
    return HtmlService.createHtmlOutput(`<h1>Error: ${error.message}</h1>`);
  } finally {
    if (tempSpreadsheet) DriveApp.getFileById(tempSpreadsheet.getId()).setTrashed(true);
  }
}

function handlePrintFact(e, spreadsheet) {
  const idVenta = e.parameter.idvnt;
  const idimgLogotipo = e.parameter.idimgurl;
  if (!idVenta) return HtmlService.createHtmlOutput('<h1>Falta ID Venta</h1>');

  try {
    const ventaData = getVentaPrincipal(spreadsheet, idVenta);
    if (!ventaData) return HtmlService.createHtmlOutput('<h1>Venta no encontrada</h1>');
    
    const productosData = getProductosRelacionados(spreadsheet, idVenta);
    let granSubTotal = 0;
    productosData.forEach(p => granSubTotal += p.subtotalNumeric);

    const dctoscalculados = ventaData.dctosNumeric * granSubTotal;
    ventaData.subtotales = formatCurrency(granSubTotal);
    ventaData.dctostotales = formatCurrency(dctoscalculados);
    ventaData.otroscargostotales = formatCurrency(ventaData.otroscargosNumeric);
    ventaData.total = formatCurrency(ventaData.otroscargosNumeric + granSubTotal - dctoscalculados);
    ventaData.imgurlempresa = idimgLogotipo;
    
    const plantilla = HtmlService.createTemplateFromFile('template');
    plantilla.Venta = ventaData;
    plantilla.Productos = productosData;
    return plantilla.evaluate().setTitle(`Orden ${ventaData.numFactura}`);
  } catch (error) {
    return HtmlService.createHtmlOutput(`<h1>Error: ${error.message}</h1>`);
  }
}

/**
 * ======================================================================
 * FUNCIONES AUXILIARES (Originales + Nueva getMedicalReportData)
 * ======================================================================
 */

function createJsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload, null, 2)).setMimeType(ContentService.MimeType.JSON);
}

function arrayToCsv(data) {
  return data.map(row => 
    row.map(cell => {
      const cellText = (cell === null || cell === undefined) ? '' : String(cell);
      if (cellText.includes(',') || cellText.includes('"') || cellText.includes('\n')) {
        return `"${cellText.replace(/"/g, '""')}"`;
      }
      return cellText;
    }).join(',')
  ).join('\n');
}

function combineData(clientesMap, facturas, detallesMap) {
  const headers = [
    'id-px', 'dni-px', 'name-px', 'lastname-px', 'gender-px', 'birthdate-px', 'old-px', 'phone-px', 'email-px', 'address-px',
    'id-fact', 'id-service', 'id-staff', 'id-convenio', 'date-muest-fact',
    'id-fact-estudio', 'id-estudio'
  ];
  const combinedRows = [headers];
  facturas.data.forEach(facturaRow => {
    const idFact = facturaRow[facturas.headers.indexOf('id-fact')];
    const idPx = facturaRow[facturas.headers.indexOf('id-px')];
    const cliente = clientesMap.get(idPx);
    const detalles = detallesMap.get(idFact);
    if (cliente && detalles) {
      detalles.forEach(detalleRow => {
        combinedRows.push([
          cliente[clientesMap.headers.indexOf('id-px')],
          cliente[clientesMap.headers.indexOf('dni-px')],
          cliente[clientesMap.headers.indexOf('name-px')],
          cliente[clientesMap.headers.indexOf('lastname-px')],
          cliente[clientesMap.headers.indexOf('gender-px')],
          cliente[clientesMap.headers.indexOf('birthdate-px')],
          cliente[clientesMap.headers.indexOf('old-px')],
          cliente[clientesMap.headers.indexOf('phone-px')],
          cliente[clientesMap.headers.indexOf('email-px')],
          cliente[clientesMap.headers.indexOf('address-px')],
          facturaRow[facturas.headers.indexOf('id-fact')],
          facturaRow[facturas.headers.indexOf('id-service')],
          facturaRow[facturas.headers.indexOf('id-staff')],
          facturaRow[facturas.headers.indexOf('id-convenio')],
          facturaRow[facturas.headers.indexOf('date-muest-fact')],
          detalleRow[detallesMap.headers.indexOf('id-fact-estudio')],
          detalleRow[detallesMap.headers.indexOf('id-estudio')]
        ]);
      });
    }
  });
  return combinedRows;
}

function getSheetDataAsMap(sheet, keyColumnName) {
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  const keyIndex = headers.indexOf(keyColumnName);
  const dataMap = new Map();
  values.forEach(row => { if (row[keyIndex]) dataMap.set(row[keyIndex], row); });
  dataMap.headers = headers;
  return dataMap;
}

function getSheetDataAsGroupedMap(sheet, keyColumnName) {
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  const keyIndex = headers.indexOf(keyColumnName);
  const dataMap = new Map();
  values.forEach(row => {
    const key = row[keyIndex];
    if (key) {
      if (!dataMap.has(key)) dataMap.set(key, []);
      dataMap.get(key).push(row);
    }
  });
  dataMap.headers = headers;
  return dataMap;
}

function getSheetData(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return { headers: headers, data: values };
}

function formatCurrency(value) {
  if (typeof value === 'number' && !isNaN(value)) return Utilities.formatString('$%.2f', value);
  return '$0.00';
}

function getClienteInfo(ss, idCliente) {
  const sheet = ss.getSheetByName(SHEET_CLIENTES);
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  const col = { id: headers.indexOf('id-px'), nombre: headers.indexOf('name-px'), telefono: headers.indexOf('phone-px') };
  for (const row of data) {
    if (row[col.id] == idCliente) return { nombre: row[col.nombre] || 'N/A', telefono: row[col.telefono] || 'N/A' };
  }
  return { nombre: 'Cliente no encontrado', telefono: 'N/A' };
}

function getVentaPrincipal(ss, idVenta) {
  const sheet = ss.getSheetByName(SHEET_FACTURAS);
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  const col = {
    id: headers.indexOf('id-fact'), fecha: headers.indexOf('date-muest-fact'),
    clienteId: headers.indexOf('id-px'), notas: headers.indexOf('notes-fact'),
    dctos: headers.indexOf('dcto-fact'), cargos: headers.indexOf('price-fact')
  };
  for (const row of data) {
    if (row[col.id] == idVenta) {
      const clienteInfo = getClienteInfo(ss, row[col.clienteId]);
      const dctos = parseFloat(row[col.dctos]) || 0;
      const cargos = parseFloat(row[col.cargos]) || 0;
      return {
        fecha: new Date(row[col.fecha]).toLocaleDateString('es-ES'),
        numFactura: row[col.id],
        nombreCliente: clienteInfo.nombre,
        telefonoCliente: clienteInfo.telefono,
        notas: row[col.notas],
        dctosNumeric: dctos,
        otroscargosNumeric: cargos
      };
    }
  }
  return null;
}

function getMaestroProductos(ss) {
  const sheet = ss.getSheetByName(SHEET_MAESTRO_PRODUCTOS);
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  const col = { id: headers.indexOf('id-estudio'), nombre: headers.indexOf('description-estudio') };
  const productosMap = new Map();
  data.forEach(row => { if (row[col.id]) productosMap.set(row[col.id], row[col.nombre]); });
  return productosMap;
}

function getProductosRelacionados(ss, idVenta) {
  const maestroProductos = getMaestroProductos(ss);
  const sheet = ss.getSheetByName(SHEET_DETALLES);
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  const productos = [];
  const col = { id: headers.indexOf('id-fact'), estId: headers.indexOf('id-estudio'), cant: headers.indexOf('cantidad-estudio'), pre: headers.indexOf('valor-estudio') };
  for (const row of data) {
    if (row[col.id] == idVenta) {
      const sub = (parseFloat(row[col.cant]) || 0) * (parseFloat(row[col.pre]) || 0);
      productos.push({
        producto: maestroProductos.get(row[col.estId]) || 'N/A',
        cantidad: row[col.cant],
        precio: formatCurrency(row[col.pre]),
        subtotal: formatCurrency(sub),
        subtotalNumeric: sub
      });
    }
  }
  return productos;
}

// --- FUNCIÓN NUEVA: RECOLECCION DE DATOS MEDICOS PARA PDF ---
function getMedicalReportData(ss, idFact) {
  // ss es el objeto spreadsheet ya abierto en doGet
  
  var getTable = function(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [];
    var data = sheet.getDataRange().getDisplayValues();
    var headers = data.shift();
    return data.map(function(row) {
      var obj = {};
      headers.forEach(function(header, i) { obj[header] = row[i]; });
      return obj;
    });
  };

  // Usamos las constantes globales donde aplique
  var facturas = getTable(SHEET_FACTURAS); // "BD_FACT"
  var factura = facturas.find(f => f['id-fact'] == idFact);
  if (!factura) return null;

  var pacientes = getTable(SHEET_CLIENTES); // "BD_PX"
  var paciente = pacientes.find(p => p['id-px'] == factura['id-px']);

  var resultadosAll = getTable(SHEET_RESULTADOS); // "BD_RESULTADOS"
  var resultadosFactura = resultadosAll.filter(r => r['id-fact'] == idFact);

  var parametros = getTable(SHEET_PARAMETROS); // "tbl_parametro"
  var familias = getTable(SHEET_FAMILIAS); // "tbl_familia"

  var agrupacion = {};

  resultadosFactura.forEach(res => {
    var paramInfo = parametros.find(p => p['id-parameter'] == res['id-parameter']);
    if (!paramInfo) return;

    var idFamilia = paramInfo['id-family'];
    var famInfo = familias.find(f => f['id-family'] == idFamilia);

    if (!agrupacion[idFamilia]) {
      agrupacion[idFamilia] = {
        info: famInfo || { 'description-family': 'Otros', 'order-family': 999 },
        resultados: []
      };
    }

    agrupacion[idFamilia].resultados.push({
      nombre: paramInfo['description-parameter'],
      resultado: (res['cuantitativo-result'] && res['cuantitativo-result'] != "") ? res['cuantitativo-result'] : res['cualitative-result'],
      unidad: paramInfo['unit-parameter'],
      referencia: (res['ref-descrip-parameter'] && res['ref-descrip-parameter'] != "") ? res['ref-descrip-parameter'] : 
                  (paramInfo['ref-descrip-parameter'] ? paramInfo['ref-descrip-parameter'] : 
                  "[" + paramInfo['min-parameter'] + " - " + paramInfo['max-parameter'] + "]"),
      orden: parseInt(paramInfo['order-parameter'] || 999)
    });
  });

  var reporteCuerpo = Object.keys(agrupacion).map(key => agrupacion[key]);
  reporteCuerpo.sort((a, b) => parseInt(a.info['order-family'] || 999) - parseInt(b.info['order-family'] || 999));
  reporteCuerpo.forEach(grupo => {
    grupo.resultados.sort((a, b) => a.orden - b.orden);
  });

  var cleanDate = function(dateStr) {
    if (!dateStr) return "";
    return dateStr.split(' ')[0];
  };

  return {
    paciente: paciente,
    factura: factura,
    fechaResultado: cleanDate(factura['date-result-fact']),
    cuerpo: reporteCuerpo,
    fechaImpresion: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd-MM-yyyy")
  };
}
