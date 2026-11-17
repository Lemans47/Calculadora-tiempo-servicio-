const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../calc.js');

const H = 60;
let n = 0;
function psv(fecha, presentacion, fin, tramos, extra) {
  return D.construir(Object.assign({
    id: 'x' + (++n), fecha, presentacion, fin,
    tramos: tramos.map(([salida, llegada]) => ({ salida, llegada })),
    jornada: 'ordinaria', tripulacionMinima: true
  }, extra || {}));
}
const ctrl = (ev, id) => ev.controles.find(c => c.id === id);

test('PSV ordinario simple dentro de límites', () => {
  const s = psv('2026-03-02', '07:00', '15:00', [['08:00', '10:00'], ['11:00', '13:30']]);
  assert.equal(s.psv, 8 * H);
  assert.equal(s.tv, 4.5 * H);
  const ev = D.evaluar(s, []);
  assert.equal(ctrl(ev, 'psv').estado, 'ok');
  assert.equal(ctrl(ev, 'tv').estado, 'ok');
  assert.equal(ctrl(ev, 'noche').detalle, 'El PSV no toca el período nocturno.');
});

test('Reducción de 30 min por aterrizaje sobre 5 solo con tripulación mínima', () => {
  const legs = [['07:00', '08:00'], ['08:30', '09:30'], ['10:00', '11:00'], ['11:30', '12:30'],
    ['13:00', '14:00'], ['14:30', '15:30'], ['16:00', '17:00']];
  const s = psv('2026-03-02', '06:30', '17:30', legs);
  assert.equal(s.aterrizajes, 7);
  const ev = D.evaluar(s, []);
  assert.equal(ctrl(ev, 'tv').limite, 7 * H);
  assert.equal(ctrl(ev, 'tv').estado, 'atencion'); // 7:00 de 7:00
  const r = psv('2026-03-02', '06:30', '17:30', legs, { tripulacionMinima: false });
  assert.equal(ctrl(D.evaluar(r, []), 'tv').limite, 8 * H);
});

test('Extensión a 14 h por contingencia solo fuera del período nocturno', () => {
  const ok = psv('2026-03-02', '07:00', '20:30', [['08:00', '11:00'], ['16:00', '19:00']], { contingencia: true });
  const c = ctrl(D.evaluar(ok, []), 'psv');
  assert.equal(c.limite, 14 * H);
  assert.equal(c.estado, 'atencion');

  const noche = psv('2026-03-02', '08:00', '21:30', [['09:00', '11:00'], ['18:00', '21:00']], { contingencia: true });
  const c2 = ctrl(D.evaluar(noche, []), 'psv');
  assert.equal(c2.limite, 12 * H);
  assert.equal(c2.estado, 'excede');

  const unVuelo = psv('2026-03-02', '07:00', '20:00', [['08:00', '11:00']], { contingencia: true });
  assert.equal(ctrl(D.evaluar(unVuelo, []), 'psv').limite, 12 * H);
});

test('Servicio previo se suma al PSV', () => {
  const s = psv('2026-03-02', '10:00', '20:00', [['11:00', '13:00']], { servicioPrevio: 3 * H });
  const c = ctrl(D.evaluar(s, []), 'psv');
  assert.equal(c.valor, 13 * H);
  assert.equal(c.estado, 'excede');
});

test('Horas correlativas cruzan medianoche y se calcula el período nocturno', () => {
  const s = psv('2026-03-02', '22:00', '01:30', [['23:00', '01:00']]);
  assert.equal(s.psv, 3.5 * H);
  assert.equal(s.nocheMax, 3.5 * H);
  assert.equal(s.dias.length, 2);
  const mapa = D.tvPorDia([s]);
  const d0 = D.dia(D.parseFecha('2026-03-02'));
  assert.equal(mapa[d0], 60);
  assert.equal(mapa[d0 + 1], 60);
});

test('Jornada especial: 20 h de PSV', () => {
  const s = psv('2026-03-02', '06:00', '01:00', [['07:30', '23:30']], { jornada: 'especial', tripulacionMinima: false, alMando: 8 * H });
  assert.equal(s.psv, 19 * H);
  const ev = D.evaluar(s, []);
  assert.equal(ctrl(ev, 'psv').limite, 20 * H);
  assert.equal(ctrl(ev, 'psv').estado, 'atencion');
  assert.equal(ctrl(ev, 'mando').estado, 'atencion');
});

test('34 h en 5 días consecutivos', () => {
  const hist = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'].map(f =>
    psv(f, '06:00', '16:00', [['07:00', '11:00'], ['11:30', '15:30']]));
  const quinto = psv('2026-03-06', '06:00', '13:00', [['07:00', '09:00'], ['10:00', '12:30']]);
  const c = ctrl(D.evaluar(quinto, hist), 'tv5');
  assert.equal(c.valor, 32 * H + 4.5 * H);
  assert.equal(c.estado, 'excede');
});

test('Descanso: racha de 6 días exige 4 días libres', () => {
  const dias = ['01', '02', '03', '04', '05', '06'];
  const hist = dias.map(d => psv('2026-03-' + d, '08:00', '12:00', [['09:00', '11:00']]));
  const s = psv('2026-03-09', '08:00', '12:00', [['09:00', '11:00']]);
  const c = ctrl(D.evaluar(s, hist), 'descansoPrevio');
  assert.equal(c.valor, 2);
  assert.equal(c.limite, 4);
  assert.equal(c.estado, 'excede');
  const t = psv('2026-03-11', '08:00', '12:00', [['09:00', '11:00']]);
  assert.equal(ctrl(D.evaluar(t, hist), 'descansoPrevio').estado, 'ok');
});

test('Más de 10 días continuos excede', () => {
  const hist = [];
  for (let d = 1; d <= 10; d++) hist.push(psv('2026-04-' + String(d).padStart(2, '0'), '08:00', '10:00', [['08:30', '09:30']]));
  const s = psv('2026-04-11', '08:00', '10:00', [['08:30', '09:30']]);
  assert.equal(ctrl(D.evaluar(s, hist), 'continuos').estado, 'excede');
});

test('Solo un segundo PSV nocturno consecutivo tras uno >50 %', () => {
  const p1 = psv('2026-05-01', '22:00', '05:00', [['23:00', '04:30']]);           // 7 h nocturnas (78 %)
  const p2bad = psv('2026-05-02', '22:00', '04:00', [['23:00', '03:30']]);        // 6 h (67 %)
  assert.equal(ctrl(D.evaluar(p2bad, [p1]), 'noche').estado, 'excede');
  const p2 = psv('2026-05-02', '23:00', '03:00', [['23:30', '02:30']]);           // 4 h (44 %)
  assert.equal(ctrl(D.evaluar(p2, [p1]), 'noche').estado, 'atencion');
  const p3 = psv('2026-05-03', '23:00', '02:00', [['23:30', '01:30']]);
  assert.equal(ctrl(D.evaluar(p3, [p1, p2]), 'noche').estado, 'excede');
  const p4 = psv('2026-05-05', '23:00', '02:00', [['23:30', '01:30']]);           // tras un día libre
  assert.equal(ctrl(D.evaluar(p4, [p1, p2]), 'noche').estado, 'ok');
});

test('Mes calendario: 100 h', () => {
  const hist = [];
  for (let d = 1; d <= 26; d += 1) {
    if ([6, 7, 8, 9, 16, 17, 18, 19].includes(d)) continue;
    hist.push(psv('2026-06-' + String(d).padStart(2, '0'), '06:00', '14:00', [['07:00', '12:30']]));
  }
  const s = psv('2026-06-28', '06:00', '14:00', [['07:00', '12:30']]);
  const c = ctrl(D.evaluar(s, hist), 'mes');
  assert.equal(c.valor, 19 * 5.5 * H);
  assert.equal(c.estado, 'excede');
});

test('Errores de formato', () => {
  const s = D.construir({ fecha: '2026-03-02', presentacion: '25:00', tramos: [{ salida: '08:00', llegada: '' }] });
  assert.ok(s.errores.length >= 2);
});

test('secuencia ubica cada tramo en su día, aun con campos vacíos', () => {
  const sq = D.secuencia({
    fecha: '2026-11-11', presentacion: '21:30', fin: '06:35',
    tramos: [{ salida: '22:30', llegada: '01:55' }, { salida: '02:45', llegada: '' }, { salida: '', llegada: '06:05' }]
  });
  const d0 = D.dia(D.parseFecha('2026-11-11'));
  assert.equal(sq.base, d0);
  assert.equal(D.dia(sq.tramos[0].salida), d0);
  assert.equal(D.dia(sq.tramos[0].llegada), d0 + 1);
  assert.equal(D.dia(sq.tramos[1].salida), d0 + 1);
  assert.equal(sq.tramos[1].llegada, null);
  assert.equal(D.dia(sq.tramos[2].llegada), d0 + 1);
  assert.equal(D.dia(sq.fin), d0 + 1);
});

test('Una hora que retrocede poco es un error, no el día siguiente', () => {
  // Caso real: último tramo llega 18:20 y el término se ingresa 17:30
  const e = { fecha: '2026-11-13', presentacion: '06:00', fin: '17:30',
    tramos: [{ salida: '07:05', llegada: '09:05' }, { salida: '16:10', llegada: '18:20' }] };
  const s = D.construir(e);
  assert.ok(s.errores);
  assert.match(s.errores[0], /término del PSV \(17:30\) es anterior a la llegada del tramo 2 \(18:20\)/);
  const sq = D.secuencia(e);
  assert.equal(sq.atras.fin, true);
  assert.equal(D.dia(sq.fin), D.dia(D.parseFecha('2026-11-13')));
  // Llegada antes que la salida
  const r = D.construir({ fecha: '2026-11-13', presentacion: '06:00', tramos: [{ salida: '10:00', llegada: '09:30' }] });
  assert.match(r.errores[0], /llegada del tramo 1 \(09:30\) es anterior a la salida del tramo 1/);
  // Retroceso grande sí es medianoche
  const n = D.construir({ fecha: '2026-11-13', presentacion: '22:00', tramos: [{ salida: '23:10', llegada: '01:05' }] });
  assert.equal(n.errores, undefined);
  assert.equal(n.tv, 115);
});
