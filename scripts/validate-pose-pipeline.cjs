const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  decodeDepthIndex,
  INPUT_HEIGHT,
} = require('../electron/rtmw3d.cjs');

function almostEqual(actual, expected, epsilon = 1e-7) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Esperado ${expected}, recebido ${actual}`,
  );
}

// Na saída SimCC com split ratio 2, o índice igual à altura da entrada
// representa o centro do eixo Z. A fórmula antiga retornava +Z_RANGE aqui.
almostEqual(decodeDepthIndex(INPUT_HEIGHT), 0);
assert.ok(decodeDepthIndex(0) < 0, 'O início do eixo Z deve estar atrás do centro.');
assert.ok(decodeDepthIndex(INPUT_HEIGHT * 2) > 0, 'O fim do eixo Z deve estar à frente do centro.');

const retargeterPath = path.join(__dirname, '..', 'src', 'lib', 'poseRetargeter.ts');
const retargeter = fs.readFileSync(retargeterPath, 'utf8');
assert.ok(
  retargeter.includes('if (!prior) return safeScore > 0.001 ? next : IDENTITY.clone();'),
  'A primeira pose precisa aplicar rotações válidas mesmo abaixo do limite de confiança.',
);
assert.ok(
  !retargeter.includes('if (score >= threshold) return candidate.normalize();'),
  'O gate antigo de confiança não pode descartar a primeira pose.',
);

console.log('RTMW3D decode e retargeting: validação concluída.');
