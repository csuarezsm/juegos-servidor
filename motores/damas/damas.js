/* Damas españolas — reglas (IT Canarias)
   © 2026 IT Canarias. Todos los derechos reservados.

   Reglas que aplica la app (reglamento de damas españolas):
   - Tablero de 8×8; se juega en 32 casillas, con la gran diagonal a la derecha de cada jugador.
     12 peones por bando en sus tres primeras filas. Empiezan las blancas.
   - El peón avanza una casilla en diagonal y captura solo hacia delante, saltando a la casilla de detrás.
   - La dama (peón coronado) vuela: se mueve cualquier número de casillas libres en diagonal, adelante o atrás,
     y captura a distancia, cayendo en cualquier casilla libre detrás de la pieza capturada.
   - Capturar es obligatorio, encadenando todas las capturas posibles. Ley de la cantidad: hay que capturar
     el máximo de piezas. Ley de la calidad: a igual número, el máximo de damas.
   - Las piezas capturadas se quitan al terminar la jugada: no se puede saltar dos veces la misma pieza ni pasar por encima.
   - El peón que llega a la última fila corona y termina la jugada.
   - Pierde quien no puede mover (sin piezas o bloqueado). Tablas: triple repetición; 20 jugadas de dama por bando
     sin mover peón ni capturar; tres damas (una en la gran diagonal) contra una dama sin ganar en 12 jugadas;
     una dama contra una dama.

   Casillas: 0x88 (sq = fila*16 + columna; fila 0 = la de las blancas). Numeración española 1–32 desde la esquina
   de las blancas: 1 = h1, 2 = f1, 3 = d1, 4 = b1, 5 = g2… 32 = a8.
   Jugada en texto («uci»): casilla de salida y todas las de llegada, p. ej. "c3d4" o "c3e5g7". */
(function (root) {
'use strict';
const WHITE = 0, BLACK = 1, MAN = 1, KING = 2;
const DIRS = [15, 17, -15, -17];
const FWD = [[15, 17], [-15, -17]];
const onBoard = s => (s & 0x88) === 0;
const playable = s => onBoard(s) && (((s >> 4) + (s & 7)) & 1) === 1;
const sqName = s => 'abcdefgh'[s & 7] + ((s >> 4) + 1);
const sqParse = t => { const m = /^([a-h])([1-8])$/.exec(String(t)); return m ? (m[2] - 1) * 16 + 'abcdefgh'.indexOf(m[1]) : -1; };
const SQS = []; for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) { const s = r * 16 + f; if (playable(s)) SQS.push(s); }
const num = s => 4 * (s >> 4) + ((7 - (s & 7)) >> 1) + 1;
const NUM2SQ = []; for (const s of SQS) NUM2SQ[num(s)] = s;
const fromNum = n => NUM2SQ[n] == null ? -1 : NUM2SQ[n];
// gran diagonal: h1–a8
const LONG_DIAG = new Set(); for (let i = 0; i < 8; i++) LONG_DIAG.add(i * 16 + (7 - i));
const promoRank = c => c === WHITE ? 7 : 0;

// Zobrist con dos mitades de 32 bits
let seed = 0x9e3779b9;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; };
const Z = []; for (let i = 0; i < 128 * 6; i++) Z.push([rnd(), rnd()]);
const ZT = [rnd(), rnd()];
const zi = (s, p) => Z[s * 6 + p];

const START_FEN = 'W:W1,2,3,4,5,6,7,8,9,10,11,12:B21,22,23,24,25,26,27,28,29,30,31,32';

class Position {
  constructor(fen) { this.load(fen || START_FEN); }
  load(fen) {
    const t = String(fen).trim().replace(/\s+/g, '');
    const m = /^([WB]):([WB])([^:]*):([WB])([^:.]*)\.?$/i.exec(t);
    if (!m) throw new Error('FEN no válido');
    this.b = new Int8Array(128);
    const put = (side, list) => {
      const c = side.toUpperCase() === 'W' ? WHITE : BLACK;
      for (let it of list.split(',').filter(Boolean)) {
        let k = false; if (/^K/i.test(it)) { k = true; it = it.slice(1); }
        const n = +it, s = fromNum(n);
        if (!(n >= 1 && n <= 32) || s < 0) throw new Error('Casilla no válida: ' + it);
        if (this.b[s]) throw new Error('Casilla repetida');
        if (!k && (s >> 4) === promoRank(c)) k = true;     // un peón en la última fila ya es dama
        this.b[s] = (c << 3) | (k ? KING : MAN);
      }
    };
    if (m[2].toUpperCase() === m[4].toUpperCase()) throw new Error('FEN no válido');
    put(m[2], m[3]); put(m[4], m[5]);
    this.turn = m[1].toUpperCase() === 'W' ? WHITE : BLACK;
    this.quiet = 0;        // medias jugadas seguidas solo de damas, sin capturas
    this.k31 = -1;         // medias jugadas desde que hay 3 damas contra 1
    this.full = 1;
    this.stack = [];
    this.computeHash();
    this.hist = [this.key()];
    this.updateK31();
  }
  computeHash() {
    let a = 0, b = 0;
    for (const s of SQS) if (this.b[s]) { const z = zi(s, this.b[s] & 7 | ((this.b[s] >> 3) * 3)); a ^= z[0]; b ^= z[1]; }
    if (this.turn) { a ^= ZT[0]; b ^= ZT[1]; }
    this.h1 = a >>> 0; this.h2 = b >>> 0;
  }
  key() { return this.h1.toString(36) + ':' + this.h2.toString(36); }
  clone() {
    const p = Object.create(Position.prototype);
    p.b = new Int8Array(this.b); p.turn = this.turn; p.quiet = this.quiet; p.k31 = this.k31; p.full = this.full;
    p.h1 = this.h1; p.h2 = this.h2; p.stack = []; p.hist = this.hist.slice();
    return p;
  }
  counts() {
    const n = [[0, 0, 0], [0, 0, 0]];
    for (const s of SQS) { const p = this.b[s]; if (p) n[p >> 3][p & 7]++; }
    return n;      // n[color][MAN|KING]
  }
  // Tres damas (alguna en la gran diagonal) contra una dama sola
  is31() {
    const n = this.counts();
    for (const c of [0, 1]) {
      if (n[c][MAN] === 0 && n[c][KING] === 3 && n[1 - c][MAN] === 0 && n[1 - c][KING] === 1) {
        for (const s of LONG_DIAG) { const p = this.b[s]; if (p && (p >> 3) === c && (p & 7) === KING) return true; }
      }
    }
    return false;
  }
  updateK31() { this.k31 = this.is31() ? (this.k31 >= 0 ? this.k31 : 0) : -1; }

  /* ---------- Generación de jugadas ---------- */
  // Jugada: { from, path:[casillas de llegada], caps:[capturadas], kc: damas capturadas, promo }
  captures(out) {
    const me = this.turn, b = this.b;
    for (const s of SQS) {
      const p = b[s]; if (!p || (p >> 3) !== me) continue;
      const king = (p & 7) === KING;
      b[s] = 0;     // la casilla de salida queda libre durante la jugada
      const caps = [], path = [];
      const rec = (at) => {
        let found = false;
        const dirs = king ? DIRS : FWD[me];
        for (const d of dirs) {
          let t = at + d;
          if (king) while (onBoard(t) && !b[t]) t += d;
          if (!onBoard(t)) continue;
          const q = b[t];
          if (!q || (q >> 3) === me || caps.includes(t)) continue;
          let l = t + d;
          while (onBoard(l) && !b[l]) {
            found = true;
            caps.push(t); path.push(l);
            const promoNow = !king && (l >> 4) === promoRank(me);
            if (promoNow || !rec(l)) out.push({ from: s, path: path.slice(), caps: caps.slice(), kc: caps.filter(c => (b[c] & 7) === KING).length, promo: promoNow });
            caps.pop(); path.pop();
            if (!king) break;
            l += d;
          }
        }
        return found;
      };
      rec(s);
      b[s] = p;
    }
    return out;
  }
  quietMoves(out) {
    const me = this.turn, b = this.b;
    for (const s of SQS) {
      const p = b[s]; if (!p || (p >> 3) !== me) continue;
      if ((p & 7) === KING) {
        for (const d of DIRS) for (let t = s + d; onBoard(t) && !b[t]; t += d) out.push({ from: s, path: [t], caps: [], kc: 0, promo: false });
      } else {
        for (const d of FWD[me]) { const t = s + d; if (onBoard(t) && !b[t]) out.push({ from: s, path: [t], caps: [], kc: 0, promo: (t >> 4) === promoRank(me) }); }
      }
    }
    return out;
  }
  legal() {
    let caps = this.captures([]);
    if (caps.length) {
      const max = Math.max(...caps.map(m => m.caps.length));
      caps = caps.filter(m => m.caps.length === max);
      const kmax = Math.max(...caps.map(m => m.kc));
      caps = caps.filter(m => m.kc === kmax);
      // quitar duplicados (mismo recorrido)
      const seen = new Set(); const out = [];
      for (const m of caps) { const k = this.uci(m); if (!seen.has(k)) { seen.add(k); out.push(m); } }
      return out;
    }
    return this.quietMoves([]);
  }
  hasLegal() {
    if (this.captures([]).length) return true;
    const me = this.turn, b = this.b;
    for (const s of SQS) {
      const p = b[s]; if (!p || (p >> 3) !== me) continue;
      for (const d of (p & 7) === KING ? DIRS : FWD[me]) { const t = s + d; if (onBoard(t) && !b[t]) return true; }
    }
    return false;
  }
  mustCapture() { return this.captures([]).length > 0; }
  make(m) {
    const b = this.b, p = b[m.from], to = m.path[m.path.length - 1], me = this.turn;
    const u = { from: m.from, to, p, caps: m.caps.map(c => [c, b[c]]), quiet: this.quiet, k31: this.k31, h1: this.h1, h2: this.h2, full: this.full };
    let h1 = this.h1, h2 = this.h2;
    const x = (s, q) => { const z = zi(s, (q & 7) | ((q >> 3) * 3)); h1 ^= z[0]; h2 ^= z[1]; };
    x(m.from, p); b[m.from] = 0;
    for (const c of m.caps) { x(c, b[c]); b[c] = 0; }
    const np = m.promo ? (me << 3) | KING : p;
    b[to] = np; x(to, np);
    h1 ^= ZT[0]; h2 ^= ZT[1];
    this.h1 = h1 >>> 0; this.h2 = h2 >>> 0;
    this.quiet = (m.caps.length || (p & 7) === MAN) ? 0 : this.quiet + 1;
    if (me === BLACK) this.full++;
    this.turn ^= 1;
    this.k31 = this.quiet || m.caps.length ? (this.is31() ? (u.k31 >= 0 ? u.k31 + 1 : 0) : -1) : -1;
    this.hist.push(this.key());
    this.stack.push(u);
    return u;
  }
  unmake() {
    const u = this.stack.pop(), b = this.b;
    b[u.to] = 0; b[u.from] = u.p;
    for (const [c, q] of u.caps) b[c] = q;
    this.turn ^= 1; this.quiet = u.quiet; this.k31 = u.k31; this.h1 = u.h1; this.h2 = u.h2; this.full = u.full;
    this.hist.pop();
  }
  repetitions() { const k = this.key(); let n = 0; for (const x of this.hist) if (x === k) n++; return n; }
  fen() {
    const list = c => SQS.filter(s => this.b[s] && (this.b[s] >> 3) === c).map(s => num(s)).sort((a, b) => a - b).map(n => ((this.b[fromNum(n)] & 7) === KING ? 'K' : '') + n).join(',');
    return (this.turn ? 'B' : 'W') + ':W' + list(WHITE) + ':B' + list(BLACK);
  }
  uci(m) { return sqName(m.from) + m.path.map(sqName).join(''); }
  fromUci(u) {
    u = String(u || ''); if (!/^([a-h][1-8]){2,}$/.test(u)) return null;
    return this.legal().find(m => this.uci(m) === u) || null;
  }
  // Notación española: 11-15, 15x22, 15x22x29 (todas las casillas de llegada)
  san(m) { return m.caps.length ? [m.from].concat(m.path).map(num).join('x') : num(m.from) + '-' + num(m.path[0]); }
  fromSan(text) {
    const t = String(text).trim().replace(/[!?+#*]+$/, '');
    const mm = /^(\d{1,2})([-x:])(\d{1,2}(?:[x:]\d{1,2})*)$/.exec(t); if (!mm) return null;
    const sqs = [+mm[1]].concat(mm[3].split(/[x:]/).map(Number));
    const L = this.legal().filter(m => num(m.from) === sqs[0] && num(m.path[m.path.length - 1]) === sqs[sqs.length - 1] && (mm[2] === '-' ? !m.caps.length : m.caps.length));
    if (sqs.length > 2) { const full = L.find(m => m.path.map(num).join() === sqs.slice(1).join()); if (full) return full; }
    return L[0] || null;
  }
}
const mFrom = m => m.from;
const mTo = m => m.path[m.path.length - 1];

const REASONS = { sinpiezas: 'sin piezas', bloqueo: 'sin jugadas', repeticion: 'triple repetición', cuarenta: '20 jugadas de dama sin capturas', tresdamas: 'tres damas contra una', damadama: 'una dama contra otra', tiempo: 'tiempo', abandono: 'abandono', acuerdo: 'acuerdo', '': '' };

function status(pos) {
  const c = pos.turn;
  if (!pos.hasLegal()) {
    const n = pos.counts()[c];
    return { over: true, result: c === WHITE ? '0-1' : '1-0', reason: n[MAN] + n[KING] ? 'bloqueo' : 'sinpiezas', mustCapture: false };
  }
  const n = pos.counts();
  if (!n[0][MAN] && !n[1][MAN] && n[0][KING] === 1 && n[1][KING] === 1) return { over: true, result: '1/2-1/2', reason: 'damadama' };
  if (pos.repetitions() >= 3) return { over: true, result: '1/2-1/2', reason: 'repeticion' };
  if (pos.quiet >= 40) return { over: true, result: '1/2-1/2', reason: 'cuarenta' };
  if (pos.k31 >= 24) return { over: true, result: '1/2-1/2', reason: 'tresdamas' };
  return { over: false, mustCapture: pos.mustCapture() };
}

// Reproduce una lista de jugadas; se para en la primera que no es válida
function replay(moves, startFen) {
  const pos = new Position(startFen || START_FEN);
  const san = [], ok = [];
  for (const u of moves || []) {
    const m = pos.fromUci(u); if (!m) break;
    san.push(pos.san(m)); ok.push(u); pos.make(m); pos.stack.length = 0;
    if (status(pos).over) break;
  }
  return { pos, san, moves: ok };
}

/* ---------- PDN (el formato de partidas de damas) ---------- */
const pdnEsc = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const PDN_RES = { '1-0': '2-0', '0-1': '0-2', '1/2-1/2': '1-1', '*': '*' };
function toPgn(o) {
  const d = o.date || (() => { const t = new Date(o.created || Date.now()); return t.getFullYear() + '.' + String(t.getMonth() + 1).padStart(2, '0') + '.' + String(t.getDate()).padStart(2, '0'); })();
  const res = PDN_RES[o.result || '*'] || '*';
  const tags = [['Event', o.event || 'Partida'], ['Site', o.site || 'Damas · IT Canarias'], ['Date', d], ['Round', o.round || '-'], ['White', o.white || '?'], ['Black', o.black || '?'], ['Result', res], ['GameType', '24']];
  if (o.startFen) tags.push(['FEN', o.startFen]);
  if (o.timeControl) tags.push(['TimeControl', o.timeControl]);
  if (o.termination) tags.push(['Termination', o.termination]);
  const R = replay(o.moves || [], o.startFen);
  const start = new Position(o.startFen || START_FEN);
  let n = start.full, w = start.turn === WHITE, line = '', out = [];
  const push = tok => { if ((line + ' ' + tok).trim().length > 79) { out.push(line.trim()); line = ''; } line += ' ' + tok; };
  R.san.forEach((s, i) => { if (w) push(n + '.'); else if (i === 0) push(n + '...'); push(s); if (!w) n++; w = !w; });
  push(res); out.push(line.trim());
  return tags.map(([k, v]) => `[${k} "${pdnEsc(v)}"]`).join('\n') + '\n\n' + out.join('\n') + '\n';
}
function parsePgn(text) {
  const games = [];
  const src = String(text || '').replace(/\r/g, '');
  const parts = src.split(/\n(?=\s*\[Event\s)/).filter(x => x.trim());
  for (const part of parts.length ? parts : [src]) {
    const tags = {};
    const body = part.replace(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm, (_, k, v) => { tags[k] = v.replace(/\\(.)/g, '$1'); return ''; });
    if (tags.GameType && !/^24\b/.test(tags.GameType)) { games.push({ tags, moves: [], startFen: null, result: '*', error: 'No son damas españolas (GameType ' + tags.GameType + ')' }); continue; }
    let startFen = null;
    if (tags.FEN) { try { new Position(tags.FEN); startFen = tags.FEN; } catch (e) { games.push({ tags, moves: [], startFen: null, result: '*', error: 'FEN no válido' }); continue; } }
    const clean = body.replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/;[^\n]*/g, ' ');
    const toks = clean.split(/\s+/).filter(Boolean);
    const pos = new Position(startFen || START_FEN); const moves = []; let result = tags.Result || '*', error = null;
    for (let tk of toks) {
      if (/^(2-0|0-2|1-1|1-0|0-1|1\/2-1\/2|0-0|\*)$/.test(tk)) { result = tk; continue; }
      tk = tk.replace(/^\d+\.(\.\.)?/, ''); if (!tk) continue;
      const m = pos.fromSan(tk);
      if (!m) { error = 'Jugada no válida: ' + tk; break; }
      moves.push(pos.uci(m)); pos.make(m); pos.stack.length = 0;
    }
    const RES = { '2-0': '1-0', '0-2': '0-1', '1-1': '1/2-1/2', '1-0': '1-0', '0-1': '0-1', '1/2-1/2': '1/2-1/2' };
    games.push({ tags, moves, startFen, result: RES[result] || '*', error });
  }
  return games;
}

// Cuenta posiciones (para comprobar el generador de jugadas)
function perft(pos, d) {
  if (d === 0) return 1;
  const L = pos.legal(); if (d === 1) return L.length;
  let n = 0; for (const m of L) { pos.make(m); n += perft(pos, d - 1); pos.unmake(); }
  return n;
}
const sanEs = s => String(s);

const API = { Position, status, replay, toPgn, parsePgn, perft, sanEs, sqName, sqParse, num, fromNum, playable, SQS, LONG_DIAG, START_FEN, REASONS,
  WHITE, BLACK, MAN, KING, mFrom, mTo };
root.Damas = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);
