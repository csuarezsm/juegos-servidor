/* Ajedrez — reglas del juego (IT Canarias)
   © 2026 IT Canarias. Todos los derechos reservados.

   Tablero 0x88. Funciona igual en la app, en el Web Worker del motor, en las pruebas (Node)
   y, más adelante, en el servidor de juegos en línea: la partida es una lista de jugadas UCI
   ("e2e4", "e7e8q") y el estado se calcula a partir de ella. */
(function (root) {
'use strict';

const WHITE = 0, BLACK = 1;
const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const F_CAP = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8, F_PROMO = 16;
const N_DIRS = [33, 31, 18, 14, -33, -31, -18, -14];
const K_DIRS = [1, -1, 16, -16, 17, 15, -17, -15];
const B_DIRS = [17, 15, -17, -15];
const R_DIRS = [1, -1, 16, -16];
const LETTER = ' pnbrqk';
// Derechos de enroque que se pierden cuando algo sale de (o llega a) cada casilla
const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[0] = 13; CASTLE_MASK[7] = 14; CASTLE_MASK[4] = 12;
CASTLE_MASK[112] = 7; CASTLE_MASK[119] = 11; CASTLE_MASK[116] = 3;

const sqName = s => 'abcdefgh'[s & 7] + ((s >> 4) + 1);
const sqParse = n => { const f = n.charCodeAt(0) - 97, r = n.charCodeAt(1) - 49; return (f >= 0 && f < 8 && r >= 0 && r < 8) ? r * 16 + f : -1; };
const mFrom = m => m & 127, mTo = m => (m >> 7) & 127, mPromo = m => (m >> 14) & 7, mFlags = m => m >> 17;
const mk = (from, to, flags, promo) => from | (to << 7) | ((promo || 0) << 14) | (flags << 17);

// Claves Zobrist (generador con semilla fija: la misma posición da la misma clave en todos los dispositivos)
let seed = 0x2f6b7a1d;
const rnd32 = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
const ZP = [new Int32Array(16 * 128), new Int32Array(16 * 128)];
for (let i = 0; i < 16 * 128; i++) { ZP[0][i] = rnd32(); ZP[1][i] = rnd32(); }
const ZSIDE = [rnd32(), rnd32()];
const ZCAS = [new Int32Array(16), new Int32Array(16)];
for (let i = 0; i < 16; i++) { ZCAS[0][i] = rnd32(); ZCAS[1][i] = rnd32(); }
const ZEP = [new Int32Array(8), new Int32Array(8)];
for (let i = 0; i < 8; i++) { ZEP[0][i] = rnd32(); ZEP[1][i] = rnd32(); }

class Position {
  constructor(fen) {
    this.b = new Int8Array(128);
    this.kings = [0, 0];
    this.stack = [];          // datos para deshacer
    this.hist = [];           // claves de las posiciones anteriores (repetición)
    this.load(fen || START_FEN);
  }
  load(fen) {
    const parts = String(fen).trim().split(/\s+/);
    if (parts.length < 4) throw new Error('FEN no válido');
    this.b.fill(0);
    const rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('FEN no válido');
    const kc = [0, 0];
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) { f += +ch; continue; }
        const t = LETTER.indexOf(ch.toLowerCase());
        if (t < 1 || f > 7) throw new Error('FEN no válido');
        const c = ch === ch.toLowerCase() ? BLACK : WHITE;
        const s = (7 - r) * 16 + f;
        this.b[s] = t | (c << 3);
        if (t === KING) { this.kings[c] = s; kc[c]++; }
        f++;
      }
      if (f !== 8) throw new Error('FEN no válido');
    }
    if (kc[0] !== 1 || kc[1] !== 1) throw new Error('Cada bando necesita un rey');
    this.turn = parts[1] === 'b' ? BLACK : WHITE;
    this.castle = 0;
    if (parts[2] !== '-') for (const ch of parts[2]) this.castle |= { K: 1, Q: 2, k: 4, q: 8 }[ch] || 0;
    // quitar derechos que no cuadran con las piezas
    if (this.b[4] !== KING || this.b[7] !== ROOK) this.castle &= ~1;
    if (this.b[4] !== KING || this.b[0] !== ROOK) this.castle &= ~2;
    if (this.b[116] !== (KING | 8) || this.b[119] !== (ROOK | 8)) this.castle &= ~4;
    if (this.b[116] !== (KING | 8) || this.b[112] !== (ROOK | 8)) this.castle &= ~8;
    this.ep = parts[3] !== '-' ? sqParse(parts[3]) : -1;
    if (this.ep >= 0 && !this.epUsable(this.ep)) this.ep = -1;
    this.half = parseInt(parts[4], 10) || 0;
    this.full = parseInt(parts[5], 10) || 1;
    this.stack = []; this.hist = [];
    this.computeHash();
    if (this.attacked(this.kings[this.turn ^ 1], this.turn)) throw new Error('El bando que no juega está en jaque');
  }
  // La captura al paso solo cuenta (para repeticiones y FEN) si hay un peón que pueda hacerla
  epUsable(ep) {
    const us = this.turn, pawn = PAWN | (us << 3), d = us === WHITE ? -16 : 16;
    return [ep + d - 1, ep + d + 1].some(s => !(s & 0x88) && this.b[s] === pawn);
  }
  computeHash() {
    let h1 = 0, h2 = 0;
    for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } const p = this.b[s]; if (p) { h1 ^= ZP[0][p * 128 + s]; h2 ^= ZP[1][p * 128 + s]; } }
    if (this.turn) { h1 ^= ZSIDE[0]; h2 ^= ZSIDE[1]; }
    h1 ^= ZCAS[0][this.castle]; h2 ^= ZCAS[1][this.castle];
    if (this.ep >= 0) { h1 ^= ZEP[0][this.ep & 7]; h2 ^= ZEP[1][this.ep & 7]; }
    this.h1 = h1; this.h2 = h2;
  }
  key() { return this.h1.toString(36) + ':' + this.h2.toString(36); }
  clone() {
    const p = Object.create(Position.prototype);
    p.b = new Int8Array(this.b); p.kings = this.kings.slice(); p.turn = this.turn; p.castle = this.castle; p.ep = this.ep;
    p.half = this.half; p.full = this.full; p.h1 = this.h1; p.h2 = this.h2; p.stack = []; p.hist = this.hist.slice();
    return p;
  }
  piece(sq) { const p = this.b[typeof sq === 'string' ? sqParse(sq) : sq]; return p ? { color: p >> 3, type: p & 7 } : null; }

  // ¿Ataca el bando `by` la casilla s?
  attacked(s, by) {
    const b = this.b;
    // peones
    const pawn = PAWN | (by << 3);
    if (by === WHITE) { if (!((s - 17) & 0x88) && b[s - 17] === pawn) return true; if (!((s - 15) & 0x88) && b[s - 15] === pawn) return true; }
    else { if (!((s + 17) & 0x88) && b[s + 17] === pawn) return true; if (!((s + 15) & 0x88) && b[s + 15] === pawn) return true; }
    const kn = KNIGHT | (by << 3), kg = KING | (by << 3);
    for (let i = 0; i < 8; i++) { const t = s + N_DIRS[i]; if (!(t & 0x88) && b[t] === kn) return true; }
    for (let i = 0; i < 8; i++) { const t = s + K_DIRS[i]; if (!(t & 0x88) && b[t] === kg) return true; }
    const bi = BISHOP | (by << 3), ro = ROOK | (by << 3), qu = QUEEN | (by << 3);
    for (let i = 0; i < 4; i++) { const d = B_DIRS[i]; let t = s + d; while (!(t & 0x88)) { const p = b[t]; if (p) { if (p === bi || p === qu) return true; break; } t += d; } }
    for (let i = 0; i < 4; i++) { const d = R_DIRS[i]; let t = s + d; while (!(t & 0x88)) { const p = b[t]; if (p) { if (p === ro || p === qu) return true; break; } t += d; } }
    return false;
  }
  inCheck(c) { return this.attacked(this.kings[c === undefined ? this.turn : c], (c === undefined ? this.turn : c) ^ 1); }

  // Jugadas pseudolegales (capturesOnly: solo capturas y coronaciones, para la quiescencia)
  pseudo(out, capturesOnly) {
    const b = this.b, us = this.turn, them = us ^ 1;
    const fwd = us === WHITE ? 16 : -16, startRank = us === WHITE ? 1 : 6, lastRank = us === WHITE ? 7 : 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = b[s]; if (!p || (p >> 3) !== us) continue;
      const t = p & 7;
      if (t === PAWN) {
        const one = s + fwd;
        if (!(one & 0x88) && !b[one]) {
          if ((one >> 4) === lastRank) { for (const pr of [QUEEN, KNIGHT, ROOK, BISHOP]) out.push(mk(s, one, F_PROMO, pr)); }
          else if (!capturesOnly) {
            out.push(mk(s, one, 0));
            const two = one + fwd;
            if ((s >> 4) === startRank && !b[two]) out.push(mk(s, two, F_DOUBLE));
          }
        }
        for (const d of [fwd - 1, fwd + 1]) {
          const c = s + d; if (c & 0x88) continue;
          const q = b[c];
          if (q && (q >> 3) === them) {
            if ((c >> 4) === lastRank) { for (const pr of [QUEEN, KNIGHT, ROOK, BISHOP]) out.push(mk(s, c, F_CAP | F_PROMO, pr)); }
            else out.push(mk(s, c, F_CAP));
          } else if (c === this.ep) out.push(mk(s, c, F_CAP | F_EP));
        }
      } else if (t === KNIGHT || t === KING) {
        const D = t === KNIGHT ? N_DIRS : K_DIRS;
        for (let i = 0; i < 8; i++) {
          const to = s + D[i]; if (to & 0x88) continue;
          const q = b[to];
          if (!q) { if (!capturesOnly) out.push(mk(s, to, 0)); }
          else if ((q >> 3) === them) out.push(mk(s, to, F_CAP));
        }
        if (t === KING && !capturesOnly) this.castles(out, s);
      } else {
        const D = t === BISHOP ? B_DIRS : t === ROOK ? R_DIRS : K_DIRS;
        for (let i = 0; i < D.length; i++) {
          const d = D[i]; let to = s + d;
          while (!(to & 0x88)) {
            const q = b[to];
            if (!q) { if (!capturesOnly) out.push(mk(s, to, 0)); }
            else { if ((q >> 3) === them) out.push(mk(s, to, F_CAP)); break; }
            to += d;
          }
        }
      }
    }
    return out;
  }
  castles(out, s) {
    const b = this.b, us = this.turn, them = us ^ 1;
    if (us === WHITE && s === 4) {
      if ((this.castle & 1) && !b[5] && !b[6] && !this.attacked(4, them) && !this.attacked(5, them) && !this.attacked(6, them)) out.push(mk(4, 6, F_CASTLE));
      if ((this.castle & 2) && !b[3] && !b[2] && !b[1] && !this.attacked(4, them) && !this.attacked(3, them) && !this.attacked(2, them)) out.push(mk(4, 2, F_CASTLE));
    } else if (us === BLACK && s === 116) {
      if ((this.castle & 4) && !b[117] && !b[118] && !this.attacked(116, them) && !this.attacked(117, them) && !this.attacked(118, them)) out.push(mk(116, 118, F_CASTLE));
      if ((this.castle & 8) && !b[115] && !b[114] && !b[113] && !this.attacked(116, them) && !this.attacked(115, them) && !this.attacked(114, them)) out.push(mk(116, 114, F_CASTLE));
    }
  }
  make(m) {
    const b = this.b, from = m & 127, to = (m >> 7) & 127, fl = m >> 17, us = this.turn, them = us ^ 1;
    const p = b[from];
    let cap = b[to], capSq = to;
    if (fl & F_EP) { capSq = to + (us === WHITE ? -16 : 16); cap = b[capSq]; }
    this.stack.push({ cap, castle: this.castle, ep: this.ep, half: this.half, h1: this.h1, h2: this.h2 });
    this.hist.push(this.h1, this.h2);
    let h1 = this.h1, h2 = this.h2;
    h1 ^= ZCAS[0][this.castle]; h2 ^= ZCAS[1][this.castle];
    if (this.ep >= 0) { h1 ^= ZEP[0][this.ep & 7]; h2 ^= ZEP[1][this.ep & 7]; }
    if (cap) { b[capSq] = 0; h1 ^= ZP[0][cap * 128 + capSq]; h2 ^= ZP[1][cap * 128 + capSq]; }
    b[from] = 0; h1 ^= ZP[0][p * 128 + from]; h2 ^= ZP[1][p * 128 + from];
    const np = (fl & F_PROMO) ? (((m >> 14) & 7) | (us << 3)) : p;
    b[to] = np; h1 ^= ZP[0][np * 128 + to]; h2 ^= ZP[1][np * 128 + to];
    if ((p & 7) === KING) {
      this.kings[us] = to;
      if (fl & F_CASTLE) {
        const rf = to > from ? from + 3 : from - 4, rt = to > from ? from + 1 : from - 1, r = b[rf];
        b[rf] = 0; b[rt] = r;
        h1 ^= ZP[0][r * 128 + rf] ^ ZP[0][r * 128 + rt]; h2 ^= ZP[1][r * 128 + rf] ^ ZP[1][r * 128 + rt];
      }
    }
    this.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.ep = -1;
    this.turn = them;
    if (fl & F_DOUBLE) { const e = (from + to) >> 1; if (this.epUsable(e)) this.ep = e; }
    h1 ^= ZCAS[0][this.castle]; h2 ^= ZCAS[1][this.castle];
    if (this.ep >= 0) { h1 ^= ZEP[0][this.ep & 7]; h2 ^= ZEP[1][this.ep & 7]; }
    h1 ^= ZSIDE[0]; h2 ^= ZSIDE[1];
    this.h1 = h1; this.h2 = h2;
    this.half = ((p & 7) === PAWN || cap) ? 0 : this.half + 1;
    if (us === BLACK) this.full++;
  }
  unmake(m) {
    const b = this.b, from = m & 127, to = (m >> 7) & 127, fl = m >> 17;
    const u = this.stack.pop(); this.hist.length -= 2;
    this.turn ^= 1; const us = this.turn;
    if (us === BLACK) this.full--;
    const np = b[to];
    const p = (fl & F_PROMO) ? (PAWN | (us << 3)) : np;
    b[from] = p; b[to] = 0;
    if (fl & F_EP) b[to + (us === WHITE ? -16 : 16)] = u.cap; else b[to] = u.cap;
    if ((p & 7) === KING) {
      this.kings[us] = from;
      if (fl & F_CASTLE) { const rf = to > from ? from + 3 : from - 4, rt = to > from ? from + 1 : from - 1; b[rf] = b[rt]; b[rt] = 0; }
    }
    this.castle = u.castle; this.ep = u.ep; this.half = u.half; this.h1 = u.h1; this.h2 = u.h2;
  }
  // Pasar turno (solo para el motor: poda de jugada nula)
  makeNull() {
    this.stack.push({ ep: this.ep, half: this.half, h1: this.h1, h2: this.h2 }); this.hist.push(this.h1, this.h2);
    if (this.ep >= 0) { this.h1 ^= ZEP[0][this.ep & 7]; this.h2 ^= ZEP[1][this.ep & 7]; }
    this.ep = -1; this.turn ^= 1; this.h1 ^= ZSIDE[0]; this.h2 ^= ZSIDE[1]; this.half++;
  }
  unmakeNull() { const u = this.stack.pop(); this.hist.length -= 2; this.turn ^= 1; this.ep = u.ep; this.half = u.half; this.h1 = u.h1; this.h2 = u.h2; }

  legal(capturesOnly) {
    const ps = this.pseudo([], capturesOnly), out = [], us = this.turn;
    for (const m of ps) { this.make(m); if (!this.attacked(this.kings[us], us ^ 1)) out.push(m); this.unmake(m); }
    return out;
  }
  hasLegal() {
    const ps = this.pseudo([]), us = this.turn;
    for (const m of ps) { this.make(m); const ok = !this.attacked(this.kings[us], us ^ 1); this.unmake(m); if (ok) return true; }
    return false;
  }
  // Repeticiones de la posición actual en la historia (sin contar la actual)
  repetitions() {
    let n = 0; const h = this.hist;
    for (let i = h.length - 2, k = 0; i >= 0 && k < this.half; i -= 2, k++) if (h[i] === this.h1 && h[i + 1] === this.h2) n++;
    return n;
  }
  insufficient() {
    const minors = [[], []]; let other = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = this.b[s]; if (!p) continue; const t = p & 7;
      if (t === KING) continue;
      if (t === KNIGHT || t === BISHOP) minors[p >> 3].push({ t, sq: ((s >> 4) + (s & 7)) & 1 });
      else other++;
    }
    if (other) return false;
    const n = minors[0].length + minors[1].length;
    if (n <= 1) return true;
    // solo alfiles y todos en casillas del mismo color
    const all = minors[0].concat(minors[1]);
    return all.every(m => m.t === BISHOP) && all.every(m => m.sq === all[0].sq);
  }
  // ¿Puede el bando c dar mate con lo que tiene? (para la caída de bandera)
  canMate(c) {
    let n = 0, b = 0, k = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const p = this.b[s]; if (!p || (p >> 3) !== c) continue; const t = p & 7;
      if (t === PAWN || t === ROOK || t === QUEEN) return true;
      if (t === BISHOP) b++; if (t === KNIGHT) k++;
    }
    n = b + k;
    return n >= 2;
  }
  fen() {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let e = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.b[r * 16 + f];
        if (!p) { e++; continue; }
        if (e) { s += e; e = 0; }
        const ch = LETTER[p & 7]; s += (p >> 3) ? ch : ch.toUpperCase();
      }
      if (e) s += e;
      if (r) s += '/';
    }
    let c = ''; if (this.castle & 1) c += 'K'; if (this.castle & 2) c += 'Q'; if (this.castle & 4) c += 'k'; if (this.castle & 8) c += 'q';
    return `${s} ${this.turn ? 'b' : 'w'} ${c || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.half} ${this.full}`;
  }
  uci(m) { return sqName(m & 127) + sqName((m >> 7) & 127) + ((m >> 17) & F_PROMO ? LETTER[(m >> 14) & 7] : ''); }
  fromUci(u) {
    u = String(u || '').toLowerCase();
    const list = this.legal();
    // se acepta también el enroque escrito como "rey toma torre" (e1h1)
    for (const m of list) if (this.uci(m) === u) return m;
    return 0;
  }
  // Notación algebraica estándar (en inglés: es la de los archivos PGN)
  san(m, legalList) {
    const fl = m >> 17, from = m & 127, to = (m >> 7) & 127, p = this.b[from], t = p & 7;
    let s;
    if (fl & F_CASTLE) s = to > from ? 'O-O' : 'O-O-O';
    else {
      s = '';
      if (t === PAWN) { if (fl & F_CAP) s = 'abcdefgh'[from & 7] + 'x'; }
      else {
        s = LETTER[t].toUpperCase();
        const list = legalList || this.legal();
        const amb = list.filter(x => x !== m && (x & 127) !== from && ((x >> 7) & 127) === to && (this.b[x & 127] & 7) === t);
        if (amb.length) {
          const sameFile = amb.some(x => ((x & 127) & 7) === (from & 7)), sameRank = amb.some(x => ((x & 127) >> 4) === (from >> 4));
          if (!sameFile) s += 'abcdefgh'[from & 7];
          else if (!sameRank) s += (from >> 4) + 1;
          else s += sqName(from);
        }
        if (fl & F_CAP) s += 'x';
      }
      s += sqName(to);
      if (fl & F_PROMO) s += '=' + LETTER[(m >> 14) & 7].toUpperCase();
    }
    this.make(m);
    if (this.inCheck()) s += this.hasLegal() ? '+' : '#';
    this.unmake(m);
    return s;
  }
  fromSan(text) {
    let t = String(text || '').trim().replace(/[+#!?]+$/g, '').replace(/[+#]/g, '').replace(/^0-0-0$/, 'O-O-O').replace(/^0-0$/, 'O-O').replace(/e\.?p\.?$/i, '').replace(/=?([QRBNqrbn])$/, (x, c) => '=' + c.toUpperCase());
    if (!t) return 0;
    const list = this.legal();
    for (const m of list) if (this.san(m, list).replace(/[+#]/g, '') === t) return m;
    // tolerar peones sin "x" (exd5 escrito como ed5) o letras de pieza en minúscula
    for (const m of list) { const s = this.san(m, list).replace(/[+#]/g, ''); if (s.replace('x', '') === t.replace('x', '')) return m; }
    const u = t.toLowerCase().replace(/[-x=]/g, '');
    for (const m of list) if (this.uci(m) === u) return m;
    return 0;
  }
}

// Estado de una posición: en juego, mate, ahogado o tablas
function status(pos) {
  const check = pos.inCheck();
  if (!pos.hasLegal()) return check ? { over: true, result: pos.turn === WHITE ? '0-1' : '1-0', reason: 'mate', check } : { over: true, result: '1/2-1/2', reason: 'ahogado', check };
  if (pos.insufficient()) return { over: true, result: '1/2-1/2', reason: 'material', check };
  if (pos.repetitions() >= 2) return { over: true, result: '1/2-1/2', reason: 'repeticion', check };
  if (pos.half >= 100) return { over: true, result: '1/2-1/2', reason: 'cincuenta', check };
  return { over: false, check };
}

// Reproduce una partida: posición final y SAN de cada jugada. Se para en la primera jugada no válida.
function replay(moves, startFen) {
  const pos = new Position(startFen || START_FEN);
  const san = [], ok = [];
  for (const u of moves || []) {
    if (status(pos).over) break;
    const m = pos.fromUci(u); if (!m) break;
    san.push(pos.san(m)); ok.push(u); pos.make(m);
  }
  return { pos, san, moves: ok };
}

const REASONS = { mate: 'jaque mate', ahogado: 'rey ahogado', material: 'material insuficiente', repeticion: 'triple repetición', cincuenta: 'regla de los 50 movimientos', tiempo: 'tiempo', abandono: 'abandono', acuerdo: 'acuerdo', '': '' };

/* ---------- PGN ---------- */
function pgnEscape(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function toPgn(g) {
  const R = replay(g.moves, g.startFen);
  const d = new Date(g.created || Date.now());
  const tags = [
    ['Event', g.event || 'Partida'], ['Site', g.site || 'Ajedrez · IT Canarias'],
    ['Date', g.date || (d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0'))],
    ['Round', g.round || '-'], ['White', g.white || '?'], ['Black', g.black || '?'], ['Result', g.result || '*']
  ];
  if (g.startFen && g.startFen !== START_FEN) tags.push(['SetUp', '1'], ['FEN', g.startFen]);
  if (g.timeControl) tags.push(['TimeControl', g.timeControl]);
  if (g.termination) tags.push(['Termination', g.termination]);
  let body = '', line = '';
  const startPos = new Position(g.startFen || START_FEN);
  let n = startPos.full, white = startPos.turn === WHITE;
  const tokens = [];
  R.san.forEach((s, i) => {
    if (white) tokens.push(n + '.'); else if (i === 0) tokens.push(n + '...');
    tokens.push(s);
    if (!white) n++;
    white = !white;
  });
  tokens.push(g.result || '*');
  for (const t of tokens) { if ((line + ' ' + t).length > 79) { body += line + '\n'; line = t; } else line = line ? line + ' ' + t : t; }
  body += line;
  return tags.map(([k, v]) => `[${k} "${pgnEscape(v)}"]`).join('\n') + '\n\n' + body + '\n';
}
// Lee uno o varios juegos en PGN. Devuelve [{tags, moves (UCI), result, startFen, error?}]
function parsePgn(text) {
  const games = [];
  const src = String(text || '').replace(/\r/g, '').replace(/^﻿/, '');
  let i = 0;
  while (i < src.length) {
    const tags = {};
    // cabecera
    const tagRe = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/;
    const lines = [];
    let rest = src.slice(i);
    const next = rest.search(/\n\s*\n\s*\[\w+\s+"/);
    let chunk = next >= 0 ? rest.slice(0, next + 1) : rest;
    i += chunk.length || rest.length;
    if (!chunk.trim()) { if (next < 0) break; continue; }
    let moveText = '';
    for (const ln of chunk.split('\n')) {
      const m = ln.match(tagRe);
      if (m && !moveText.trim()) tags[m[1]] = m[2].replace(/\\(.)/g, '$1');
      else moveText += ln + '\n';
    }
    lines.push(moveText);
    // quitar comentarios, variantes y anotaciones
    let mt = moveText.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
    let prev; do { prev = mt; mt = mt.replace(/\([^()]*\)/g, ' '); } while (mt !== prev);
    mt = mt.replace(/\$\d+/g, ' ').replace(/\d+\.(\.\.)?/g, ' ');
    const toks = mt.split(/\s+/).filter(Boolean);
    const startFen = tags.FEN || START_FEN;
    let pos, error = null;
    try { pos = new Position(startFen); } catch (e) { games.push({ tags, moves: [], result: '*', startFen, error: 'FEN no válido' }); continue; }
    const moves = []; let result = tags.Result || '*';
    for (const t of toks) {
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) { result = t; break; }
      const m = pos.fromSan(t);
      if (!m) { error = 'Jugada no válida: ' + t; break; }
      moves.push(pos.uci(m)); pos.make(m);
    }
    if (!moves.length && !Object.keys(tags).length) continue;
    games.push({ tags, moves, result, startFen: startFen === START_FEN ? null : startFen, error });
  }
  return games;
}

// Recorrido de perft (para comprobar el generador de jugadas)
function perft(pos, depth) {
  if (!depth) return 1;
  const list = pos.legal(); if (depth === 1) return list.length;
  let n = 0; for (const m of list) { pos.make(m); n += perft(pos, depth - 1); pos.unmake(m); }
  return n;
}

// Notación en español para mostrar (R rey, D dama, T torre, A alfil, C caballo)
const ES = { K: 'R', Q: 'D', R: 'T', B: 'A', N: 'C' };
const sanEs = s => String(s).replace(/[KQRBN]/g, c => ES[c]);

const API = { Position, status, replay, toPgn, parsePgn, perft, sanEs, sqName, sqParse, START_FEN, REASONS,
  WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, F_CAP, F_EP, F_CASTLE, F_DOUBLE, F_PROMO, mFrom, mTo, mPromo, mFlags, LETTER };
root.Ajedrez = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);
