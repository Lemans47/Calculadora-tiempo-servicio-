/*
 * Motor de cálculo DAN 121 — 121.605
 * Tiempo de Vuelo (TV), Período de Servicio de Vuelo (PSV) y Períodos de Descanso
 * de Tripulantes de Vuelo (pilotos).
 *
 * Todas las horas se manejan como minutos. Las fechas/horas ingresadas se tratan
 * como hora local "ingenua" (sin zona horaria), así el cambio de horario no altera
 * las duraciones.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DAN121 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var H = 60;
  var DIA = 24 * H;

  var LIMITES = {
    psvOrdinaria: 12 * H,          // 121.605(b)(2)(i)(A)
    psvExtendida: 14 * H,          // 121.605(a)(8)
    psvEspecial: 20 * H,           // 121.605(b)(2)(i)(A)
    tvOrdinaria: 8 * H,            // 121.605(b)(2)(i)(A)
    alMando: 8 * H,                // 121.1 Horas de vuelo al mando de controles
    tv5dias: 34 * H,               // (b)(2)(i)(B)
    tv10dias: 68 * H,              // (b)(2)(i)(C)
    tvMes: 100 * H,                // (b)(2)(i)(D)
    tvTrimestre: 270 * H,          // (b)(2)(i)(E)
    tvAnio: 1000 * H,              // (b)(2)(i)(F)
    nocheInicio: 21 * H,           // período nocturno 21:00 - 06:00
    nocheFin: 6 * H,
    nocheDuracion: 9 * H,
    aterrizajesSinReduccion: 5,    // (b)(2)(ii)
    reduccionPorAterrizaje: 30,
    descansoHasta5: 2,             // (a)(9)
    descansoHasta10: 4,
    diasContinuosMax: 10,
    umbralAviso: 0.9               // se avisa al llegar al 90 % de un límite
  };

  /* ---------- utilidades de tiempo ---------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function parseFecha(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 60000;
  }

  function parseHora(str) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return h * H + mi;
  }

  function hm(min) {
    if (min == null || isNaN(min)) return '—';
    var s = min < 0 ? '-' : '';
    var a = Math.round(Math.abs(min));
    return s + pad(Math.floor(a / H)) + ':' + pad(a % H);
  }

  function dia(t) { return Math.floor(t / DIA); }
  function horaDelDia(t) { return ((t % DIA) + DIA) % DIA; }

  function diaISO(d) { return new Date(d * DIA * 60000).toISOString().slice(0, 10); }
  function fechaHora(t) { return diaISO(dia(t)) + ' ' + hm(horaDelDia(t)); }

  function partesDia(d) {
    var dt = new Date(d * DIA * 60000);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
  }

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function fechaLarga(d) {
    var p = partesDia(d);
    return p.d + ' ' + MESES[p.m].slice(0, 3) + ' ' + p.y;
  }

  function solape(a0, a1, b0, b1) { return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)); }

  /* ---------- período nocturno ---------- */

  // Devuelve los minutos dentro de cada noche (21:00-06:00) que toca el intervalo.
  function nochesTocadas(t0, t1) {
    var res = [];
    for (var d = dia(t0) - 1; d <= dia(t1); d++) {
      var n0 = d * DIA + LIMITES.nocheInicio;
      var n1 = n0 + LIMITES.nocheDuracion;
      var s = solape(t0, t1, n0, n1);
      if (s > 0) res.push({ inicio: n0, fin: n1, minutos: s });
    }
    return res;
  }

  function enPeriodoNocturno(t) {
    var h = horaDelDia(t);
    return h >= LIMITES.nocheInicio || h < LIMITES.nocheFin;
  }

  /* ---------- construcción de un período de servicio ---------- */

  /*
   * entrada = {
   *   id, fecha:'YYYY-MM-DD', presentacion:'HH:MM', fin:'HH:MM' (opcional),
   *   tramos:[{ origen, destino, salida:'HH:MM', llegada:'HH:MM' }],
   *   jornada:'ordinaria'|'especial', tripulacionMinima:bool,
   *   contingencia:bool, servicioPrevio:minutos, alMando:minutos (opcional)
   * }
   * Las horas son correlativas: si una hora es menor que la anterior se asume
   * que corresponde al día siguiente.
   */
  function construir(entrada) {
    var errores = [];
    var base = parseFecha(entrada.fecha);
    if (base == null) errores.push('Falta la fecha de presentación.');
    var tramos = (entrada.tramos || []).filter(function (t) {
      return t && (t.salida || t.llegada);
    });

    var secuencia = [{ k: 'presentacion', v: entrada.presentacion }];
    tramos.forEach(function (t, i) {
      secuencia.push({ k: 'salida', i: i, v: t.salida });
      secuencia.push({ k: 'llegada', i: i, v: t.llegada });
    });
    var tieneFin = !!(entrada.fin && String(entrada.fin).trim());
    if (tieneFin) secuencia.push({ k: 'fin', v: entrada.fin });

    function nombreDe(s) {
      return s.k === 'presentacion' ? 'la presentación'
        : s.k === 'fin' ? 'el término del PSV'
        : (s.k === 'salida' ? 'la salida' : 'la llegada') + ' del tramo ' + (s.i + 1);
    }

    var abs = [];
    var prev = null, prevPaso = null;
    secuencia.forEach(function (s) {
      var h = parseHora(s.v);
      if (h == null) {
        errores.push('Revisa ' + nombreDe(s) + ' (formato HH:MM, 24 horas).');
        abs.push(null);
        return;
      }
      if (base == null) { abs.push(null); return; }
      var u = ubicar(prev, h, base);
      if (u.atras) {
        var txt = nombreDe(s);
        errores.push(txt.charAt(0).toUpperCase() + txt.slice(1) + ' (' + hm(h) + ') es anterior a ' +
          nombreDe(prevPaso) + ' (' + hm(horaDelDia(prev)) + ').');
      }
      abs.push(u.t);
      prev = u.t;
      prevPaso = s;
    });

    if (errores.length) return { errores: errores, entrada: entrada };

    var inicio = abs[0];
    var piernas = tramos.map(function (t, i) {
      var off = abs[1 + i * 2], on = abs[2 + i * 2];
      return { origen: t.origen || '', destino: t.destino || '', salida: off, llegada: on, duracion: on - off };
    });
    var fin = tieneFin ? abs[abs.length - 1]
      : (piernas.length ? piernas[piernas.length - 1].llegada : inicio);

    var noches = nochesTocadas(inicio, fin);
    var nocheTotal = noches.reduce(function (a, n) { return a + n.minutos; }, 0);
    var nocheMax = noches.reduce(function (a, n) { return Math.max(a, n.minutos); }, 0);

    return {
      id: entrada.id,
      entrada: entrada,
      inicio: inicio,
      fin: fin,
      psv: fin - inicio,
      piernas: piernas,
      tv: piernas.reduce(function (a, p) { return a + p.duracion; }, 0),
      aterrizajes: piernas.length,
      esVuelo: piernas.length > 0,
      jornada: entrada.jornada === 'especial' ? 'especial' : 'ordinaria',
      tripulacionMinima: entrada.tripulacionMinima !== false,
      contingencia: !!entrada.contingencia,
      servicioPrevio: Math.max(0, +entrada.servicioPrevio || 0),
      alMando: entrada.alMando == null || entrada.alMando === '' ? null : +entrada.alMando,
      noches: noches,
      nocheTotal: nocheTotal,
      nocheMax: nocheMax,
      nochePct: nocheMax / LIMITES.nocheDuracion,
      inicioNocturno: enPeriodoNocturno(inicio),
      dias: diasDe(inicio, fin)
    };
  }

  /*
   * Regla para ubicar una hora respecto de la anterior:
   * - si es igual o posterior, es el mismo día;
   * - si retrocede más de 4 h, se entiende que pasó la medianoche (día siguiente),
   *   p. ej. 23:10 → 01:05;
   * - si retrocede 4 h o menos, es un error de ingreso (p. ej. término 17:30 con
   *   llegada 18:20): se deja en el mismo día y se marca "atras".
   * Con el PSV máximo de 20 h nunca hay un salto real hacia adelante de más de 20 h.
   */
  var UMBRAL_RETROCESO = 4 * H;
  function ubicar(prev, h, base) {
    if (prev == null) return { t: base + h, atras: false };
    var t = dia(prev) * DIA + h;
    if (t >= prev) return { t: t, atras: false };
    if (prev - t > UMBRAL_RETROCESO) return { t: t + DIA, atras: false };
    return { t: t, atras: true };
  }

  /*
   * Ubica cada hora del formulario en su día, con la misma regla que construir():
   * si una hora es menor que la anterior, pasa al día siguiente. Tolera campos vacíos
   * (quedan en null) para poder mostrar el día mientras se completa el formulario.
   */
  function secuencia(entrada) {
    var base = parseFecha(entrada.fecha);
    var prev = null;
    var atras = { presentacion: false, tramos: [], fin: false };
    function paso(v) {
      var h = parseHora(v);
      if (h == null || base == null) return { t: null, atras: false };
      var u = ubicar(prev, h, base);
      prev = u.t;
      return u;
    }
    var p = paso(entrada.presentacion);
    var res = { base: base == null ? null : dia(base), presentacion: p.t, tramos: [], fin: null, atras: atras };
    (entrada.tramos || []).forEach(function (t) {
      var s = paso(t.salida), l = paso(t.llegada);
      res.tramos.push({ salida: s.t, llegada: l.t });
      atras.tramos.push({ salida: s.atras, llegada: l.atras });
    });
    if (entrada.fin && String(entrada.fin).trim()) {
      var f = paso(entrada.fin);
      res.fin = f.t;
      atras.fin = f.atras;
    }
    return res;
  }

  function diasDe(t0, t1) {
    var out = [];
    var last = t1 > t0 ? dia(t1 - 1) : dia(t0);
    for (var d = dia(t0); d <= last; d++) out.push(d);
    return out;
  }

  /* ---------- acumulados ---------- */

  // TV por día calendario, prorrateando los tramos que cruzan la medianoche.
  function tvPorDia(servicios) {
    var mapa = {};
    servicios.forEach(function (s) {
      s.piernas.forEach(function (p) {
        for (var d = dia(p.salida); d <= dia(Math.max(p.salida, p.llegada - 1)); d++) {
          var m = solape(p.salida, p.llegada, d * DIA, (d + 1) * DIA);
          if (m > 0) mapa[d] = (mapa[d] || 0) + m;
        }
      });
    });
    return mapa;
  }

  function diasTrabajados(servicios) {
    var set = {};
    servicios.forEach(function (s) { s.dias.forEach(function (d) { set[d] = true; }); });
    return set;
  }

  function suma(mapa, d0, d1) {
    var t = 0;
    for (var d = d0; d <= d1; d++) t += mapa[d] || 0;
    return t;
  }

  function racha(set, d) {
    var a = d, b = d;
    while (set[a - 1]) a--;
    while (set[b + 1]) b++;
    return { desde: a, hasta: b, dias: b - a + 1 };
  }

  function descansoRequerido(dias) {
    return dias <= 5 ? LIMITES.descansoHasta5 : LIMITES.descansoHasta10;
  }

  function estado(valor, limite) {
    if (valor > limite) return 'excede';
    if (valor >= limite * LIMITES.umbralAviso) return 'atencion';
    return 'ok';
  }

  /* ---------- evaluación ---------- */

  /*
   * Evalúa un servicio (ya construido) frente al resto del registro.
   * Devuelve { servicio, controles:[...], resumen }.
   * Cada control: { id, titulo, ref, valor, limite, estado, detalle, grupo }
   * estado: 'ok' | 'atencion' | 'excede' | 'info'
   */
  function evaluar(servicio, otros) {
    otros = (otros || []).filter(function (o) { return o && !o.errores && o.id !== servicio.id; });
    var todos = otros.concat([servicio]).sort(function (a, b) { return a.inicio - b.inicio; });
    var controles = [];
    var s = servicio;

    /* --- PSV --- */
    if (s.esVuelo) {
      var limitePSV, detallePSV;
      if (s.jornada === 'especial') {
        limitePSV = LIMITES.psvEspecial;
        detallePSV = 'Jornada especial: PSV máximo de 20 horas.';
      } else {
        limitePSV = LIMITES.psvOrdinaria;
        detallePSV = 'Jornada ordinaria: PSV máximo de 12 horas.';
        if (s.contingencia) {
          var motivos = [];
          if (s.aterrizajes < 2) motivos.push('el PSV debe comprender dos o más vuelos');
          if (s.inicioNocturno) motivos.push('el PSV se inició entre las 21:00 y las 06:00 (b)(1)(ii)');
          else if (s.nocheTotal > 0) motivos.push('parte del PSV cae en el período nocturno 21:00–06:00 (a)(8)');
          if (motivos.length) {
            detallePSV += ' No procede la extensión a 14 h: ' + motivos.join('; ') + '.';
          } else {
            limitePSV = LIMITES.psvExtendida;
            detallePSV = 'Extensión por contingencia aplicable: máximo 14 horas. Requiere registro de las razones con firma del Piloto al Mando (b)(1)(vi).';
          }
        }
      }
      var totalPSV = s.psv + s.servicioPrevio;
      var est = estado(totalPSV, limitePSV);
      if (est === 'ok' && s.jornada === 'ordinaria' && totalPSV > LIMITES.psvOrdinaria) est = 'atencion';
      if (s.servicioPrevio > 0) {
        detallePSV += ' Se suma el período de servicio previo de ' + hm(s.servicioPrevio) + ' (b)(1)(vii).';
      }
      controles.push({
        id: 'psv', grupo: 'psv', titulo: s.servicioPrevio > 0 ? 'Servicio previo + PSV' : 'Período de Servicio de Vuelo',
        ref: s.jornada === 'especial' ? '121.605(b)(2)(i)(A)' : (limitePSV === LIMITES.psvExtendida ? '121.605(a)(8)' : '121.605(b)(2)(i)(A)'),
        valor: totalPSV, limite: limitePSV, estado: est, detalle: detallePSV
      });

      /* --- TV del PSV --- */
      if (s.jornada === 'ordinaria') {
        var reduccion = 0;
        var exceso = Math.max(0, s.aterrizajes - LIMITES.aterrizajesSinReduccion);
        if (s.tripulacionMinima) reduccion = exceso * LIMITES.reduccionPorAterrizaje;
        var limiteTV = LIMITES.tvOrdinaria - reduccion;
        var detTV = s.aterrizajes + (s.aterrizajes === 1 ? ' aterrizaje' : ' aterrizajes') + '. ';
        if (reduccion > 0) detTV += 'Se descuentan 30 min por cada aterrizaje sobre 5 (−' + hm(reduccion) + ') por ser tripulación mínima.';
        else if (exceso > 0) detTV += 'No se aplica la reducción por aterrizajes: no es tripulación mínima.';
        else detTV += 'Hasta 5 aterrizajes no hay reducción.';
        controles.push({
          id: 'tv', grupo: 'psv', titulo: 'Tiempo de vuelo (entre calzos)',
          ref: reduccion > 0 ? '121.605(b)(2)(ii)' : '121.605(b)(2)(i)(A)',
          valor: s.tv, limite: limiteTV, estado: estado(s.tv, limiteTV), detalle: detTV
        });
      } else {
        controles.push({
          id: 'tv', grupo: 'psv', titulo: 'Tiempo de vuelo (entre calzos)',
          ref: '121.605(b)(2)(i)(A)', valor: s.tv, limite: null, estado: 'info',
          detalle: 'En jornada especial el TV es el que resulte dentro del PSV de 20 h. Cada piloto no puede superar 8 h al mando de los controles.'
        });
      }

      /* --- Horas al mando --- */
      if (s.alMando != null && !isNaN(s.alMando)) {
        controles.push({
          id: 'mando', grupo: 'psv', titulo: 'Horas al mando de controles (por piloto)',
          ref: '121.1', valor: s.alMando, limite: LIMITES.alMando,
          estado: s.alMando > s.tv ? 'excede' : estado(s.alMando, LIMITES.alMando),
          detalle: s.alMando > s.tv ? 'Las horas al mando no pueden superar el tiempo de vuelo del PSV.'
            : 'Máximo 8 horas continuas o discontinuas por jornada.'
        });
      }

      /* --- Restricción nocturna --- */
      var nocturno = controlNocturno(s, todos);
      controles.push(nocturno);
    }

    /* --- Acumulados de TV --- */
    var mapaTV = tvPorDia(todos);
    var set = diasTrabajados(todos);
    var dMin = s.dias[0], dMax = s.dias[s.dias.length - 1];

    // 34 h en 5 días consecutivos: peor ventana que incluya algún día de este servicio
    var peor5 = { valor: -1 };
    for (var d0 = dMin - 4; d0 <= dMax; d0++) {
      var v = suma(mapaTV, d0, d0 + 4);
      if (v > peor5.valor) peor5 = { valor: v, desde: d0, hasta: d0 + 4 };
    }
    controles.push({
      id: 'tv5', grupo: 'acum', titulo: 'TV en 5 días consecutivos', ref: '121.605(b)(2)(i)(B)',
      valor: peor5.valor, limite: LIMITES.tv5dias, estado: estado(peor5.valor, LIMITES.tv5dias),
      detalle: 'Ventana más cargada: ' + fechaLarga(peor5.desde) + ' – ' + fechaLarga(peor5.hasta) + '.'
    });

    // 68 h cuando la actividad se extiende entre 6 y 10 días consecutivos
    var r = racha(set, dMin);
    if (r.dias >= 6) {
      var peor10 = { valor: -1 };
      var largo = Math.min(10, r.dias);
      for (var i = r.desde; i + largo - 1 <= r.hasta; i++) {
        var v10 = suma(mapaTV, i, i + largo - 1);
        if (v10 > peor10.valor) peor10 = { valor: v10, desde: i, hasta: i + largo - 1 };
      }
      controles.push({
        id: 'tv10', grupo: 'acum', titulo: 'TV en ' + (r.dias > 10 ? '10' : r.dias) + ' días de actividad consecutiva',
        ref: '121.605(b)(2)(i)(C)', valor: peor10.valor, limite: LIMITES.tv10dias,
        estado: estado(peor10.valor, LIMITES.tv10dias),
        detalle: 'Racha de ' + r.dias + ' días (' + fechaLarga(r.desde) + ' – ' + fechaLarga(r.hasta) + '). Además, ninguna ventana de 5 días puede superar 34 h.'
      });
    } else {
      controles.push({
        id: 'tv10', grupo: 'acum', titulo: 'TV en 6 a 10 días de actividad consecutiva',
        ref: '121.605(b)(2)(i)(C)', valor: suma(mapaTV, r.desde, r.hasta), limite: LIMITES.tv10dias, estado: 'info',
        detalle: 'No aplica: la racha actual es de ' + r.dias + (r.dias === 1 ? ' día.' : ' días.')
      });
    }

    // Mes, trimestre y año calendario (se toma el más exigido si el servicio cruza el límite)
    controles.push(peorPeriodo(s, mapaTV, 'mes'));
    controles.push(peorPeriodo(s, mapaTV, 'trimestre'));
    controles.push(peorPeriodo(s, mapaTV, 'anio'));

    /* --- Días continuos y descanso --- */
    controles = controles.concat(controlDescanso(r, set));

    var peor = controles.reduce(function (acc, c) {
      var rango = { ok: 0, info: 0, atencion: 1, excede: 2 };
      return rango[c.estado] > rango[acc] ? c.estado : acc;
    }, 'ok');

    return { servicio: s, controles: controles, resultado: peor, racha: r };
  }

  function controlNocturno(s, todos) {
    var pct = s.nochePct;
    var base = {
      id: 'noche', grupo: 'psv', titulo: 'Período nocturno (21:00–06:00)', ref: '121.605(b)(1)(v)',
      valor: s.nocheMax, limite: null, estado: 'info'
    };
    if (s.nocheTotal === 0) {
      base.detalle = 'El PSV no toca el período nocturno.';
      return base;
    }
    base.detalle = 'Cubre el ' + Math.round(pct * 100) + ' % del período nocturno.';

    // Cadena de PSV nocturnos consecutivos que preceden a este
    var idx = todos.indexOf(s);
    var cadena = [];
    var actual = s;
    for (var i = idx - 1; i >= 0; i--) {
      var p = todos[i];
      if (!p.esVuelo) continue;
      if (dia(actual.inicio) - dia(p.fin - 1) > 1) break; // hubo al menos un día libre
      if (p.nocheTotal === 0) break;
      cadena.push(p);
      actual = p;
    }
    var posMayor = -1;
    for (var j = 0; j < cadena.length; j++) {
      if (cadena[j].nochePct > 0.5) { posMayor = j; break; }
    }
    if (posMayor === -1) {
      base.estado = pct > 0.5 ? 'atencion' : 'ok';
      if (pct > 0.5) base.detalle += ' Supera el 50 %: el siguiente PSV nocturno consecutivo no podrá exceder el 50 % y será el último.';
      return base;
    }
    var previo = cadena[posMayor];
    if (posMayor === 0) {
      if (pct > 0.5) {
        base.estado = 'excede';
        base.detalle += ' El PSV anterior (' + fechaHora(previo.inicio) + ') cubrió el ' + Math.round(previo.nochePct * 100) +
          ' %: este segundo PSV nocturno consecutivo no puede exceder el 50 %.';
      } else {
        base.estado = 'atencion';
        base.detalle += ' Es el segundo PSV nocturno consecutivo permitido tras uno que superó el 50 % (' +
          fechaHora(previo.inicio) + '). No puede haber un tercero.';
      }
    } else {
      base.estado = 'excede';
      base.detalle += ' Ya se efectuó el segundo PSV nocturno consecutivo después del PSV del ' +
        fechaHora(previo.inicio) + ' (más del 50 %). Solo se permite uno.';
    }
    return base;
  }

  function claves(d) {
    var p = partesDia(d);
    return { mes: p.y + '-' + p.m, trimestre: p.y + '-T' + Math.floor(p.m / 3), anio: '' + p.y, p: p };
  }

  function rangoPeriodo(d, tipo) {
    var p = partesDia(d);
    var y = p.y, m0, m1;
    if (tipo === 'mes') { m0 = p.m; m1 = p.m + 1; }
    else if (tipo === 'trimestre') { m0 = Math.floor(p.m / 3) * 3; m1 = m0 + 3; }
    else { m0 = 0; m1 = 12; }
    var d0 = Date.UTC(y, m0, 1) / 60000 / DIA;
    var d1 = Date.UTC(y, m1, 1) / 60000 / DIA - 1;
    var nombre = tipo === 'mes' ? MESES[p.m] + ' ' + y
      : tipo === 'trimestre' ? (Math.floor(p.m / 3) + 1) + 'º trimestre ' + y : 'año ' + y;
    return { desde: d0, hasta: d1, nombre: nombre };
  }

  function peorPeriodo(s, mapa, tipo) {
    var limite = tipo === 'mes' ? LIMITES.tvMes : tipo === 'trimestre' ? LIMITES.tvTrimestre : LIMITES.tvAnio;
    var ref = tipo === 'mes' ? '121.605(b)(2)(i)(D)' : tipo === 'trimestre' ? '121.605(b)(2)(i)(E)' : '121.605(b)(2)(i)(F)';
    var titulo = tipo === 'mes' ? 'TV en el mes calendario' : tipo === 'trimestre' ? 'TV en el trimestre calendario' : 'TV en el año calendario';
    var vistos = {}, peor = null;
    s.dias.forEach(function (d) {
      var k = claves(d)[tipo];
      if (vistos[k]) return;
      vistos[k] = true;
      var rg = rangoPeriodo(d, tipo);
      var v = suma(mapa, rg.desde, rg.hasta);
      if (!peor || v > peor.valor) peor = { valor: v, rango: rg };
    });
    return {
      id: tipo, grupo: 'acum', titulo: titulo, ref: ref, valor: peor.valor, limite: limite,
      estado: estado(peor.valor, limite), detalle: 'Período: ' + peor.rango.nombre + '.'
    };
  }

  function controlDescanso(r, set) {
    var out = [];
    var c = {
      id: 'continuos', grupo: 'descanso', titulo: 'Días continuos de labores', ref: '121.605(a)(9)',
      valor: r.dias, limite: LIMITES.diasContinuosMax, unidad: 'dias',
      estado: r.dias > LIMITES.diasContinuosMax ? 'excede' : r.dias >= 9 ? 'atencion' : 'ok',
      detalle: 'Racha del ' + fechaLarga(r.desde) + ' al ' + fechaLarga(r.hasta) + '. ' +
        (r.dias > LIMITES.diasContinuosMax ? 'La norma contempla labores continuas hasta 10 días.'
          : 'Al terminar corresponde un descanso mínimo de ' + descansoRequerido(r.dias) + ' días.')
    };
    out.push(c);

    // descanso antes de la racha
    var prev = null;
    for (var d = r.desde - 1; d >= r.desde - 400; d--) { if (set[d]) { prev = d; break; } }
    if (prev != null) {
      var rp = racha(set, prev);
      var gap = r.desde - prev - 1;
      var req = descansoRequerido(rp.dias);
      out.push({
        id: 'descansoPrevio', grupo: 'descanso', titulo: 'Descanso previo a esta racha', ref: '121.605(a)(9)',
        valor: gap, limite: req, unidad: 'dias', minimo: true,
        estado: gap < req ? 'excede' : 'ok',
        detalle: 'La racha anterior fue de ' + rp.dias + (rp.dias === 1 ? ' día' : ' días') + ' (hasta el ' + fechaLarga(rp.hasta) +
          '): exige al menos ' + req + ' días de descanso; hubo ' + gap + '.'
      });
    }

    // descanso posterior
    var next = null;
    for (var e = r.hasta + 1; e <= r.hasta + 400; e++) { if (set[e]) { next = e; break; } }
    var reqDesp = descansoRequerido(r.dias);
    var libre = r.hasta + reqDesp + 1;
    if (next != null) {
      var gap2 = next - r.hasta - 1;
      out.push({
        id: 'descansoPosterior', grupo: 'descanso', titulo: 'Descanso posterior a esta racha', ref: '121.605(a)(9)',
        valor: gap2, limite: reqDesp, unidad: 'dias', minimo: true,
        estado: gap2 < reqDesp ? 'excede' : 'ok',
        detalle: 'Próximo servicio registrado: ' + fechaLarga(next) + '. Exige ' + reqDesp + ' días de descanso; hay ' + gap2 + '.'
      });
    } else {
      out.push({
        id: 'proximoDia', grupo: 'descanso', titulo: 'Próximo día disponible', ref: '121.605(a)(9)',
        valor: null, limite: null, estado: 'info', texto: fechaLarga(libre),
        detalle: 'Si la racha termina el ' + fechaLarga(r.hasta) + ', corresponden ' + reqDesp + ' días de descanso.'
      });
    }
    return out;
  }

  return {
    LIMITES: LIMITES,
    construir: construir,
    secuencia: secuencia,
    evaluar: evaluar,
    tvPorDia: tvPorDia,
    nochesTocadas: nochesTocadas,
    hm: hm,
    parseHora: parseHora,
    parseFecha: parseFecha,
    dia: dia,
    diaISO: diaISO,
    fechaLarga: fechaLarga,
    fechaHora: fechaHora,
    horaDelDia: horaDelDia,
    rangoPeriodo: rangoPeriodo,
    DIA: DIA
  };
});
