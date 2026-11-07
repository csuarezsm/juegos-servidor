'use strict';
/*
 * Carga el motor de cada juego (copia de los archivos de reglas de su app, en motores/<juego>/)
 * dentro de un contexto aislado de Node. El servidor usa exactamente las mismas reglas que la app.
 * Barajar usa números aleatorios criptográficos.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MOTORES = process.env.MOTORES_DIR || path.join(__dirname, '..', 'motores');

function cargar(ficheros, exporta) {
  const MathSeguro = Object.create(Math);
  MathSeguro.random = () => crypto.randomInt(0, 2 ** 47) / 2 ** 47;
  const ctx = vm.createContext({ Math: MathSeguro, Date, JSON, Object, Array, Number, String, Set, Map, console });
  for (const f of ficheros) vm.runInContext(fs.readFileSync(path.join(MOTORES, f), 'utf8'), ctx, { filename: f });
  vm.runInContext('globalThis.__E = {' + exporta.join(',') + '}', ctx);
  return ctx.__E;
}

const chinchon = cargar(['chinchon/marcador.js', 'chinchon/juego.js'], [
  'compute', 'dealHand', 'drawFrom', 'botStep', 'closeHand', 'nextTurn', 'bestMelds', 'bestDiscard',
  'canCloseNow', 'closeFrom', 'roundOf', 'CLOSE_MAX', 'DEF_CFG', 'pname', 'canRebuy', 'rebuyScore',
  'usePlayRules', 'theCard', 'card', 'isChinchon'
]);

const pumba = cargar(['pumba/marcador.js', 'pumba/juego.js'], [
  'compute', 'dealHand', 'playCard', 'drawTurn', 'claimPumba', 'closeHand', 'botChoose', 'botStep', 'botRebuys',
  'canPlay', 'playable', 'handPoints', 'canRebuy', 'rebuyScore', 'pname', 'DEF_CFG', 'newPlay', 'usePlayRules'
]);

// Ajedrez: su archivo de reglas no depende de nada y se carga tal cual
const ajedrez = require(path.join(MOTORES, 'ajedrez', 'ajedrez.js'));

// Damas: igual, un solo archivo de reglas sin dependencias
const damas = require(path.join(MOTORES, 'damas', 'damas.js'));

module.exports = { chinchon, ajedrez, pumba, damas, cargar };
