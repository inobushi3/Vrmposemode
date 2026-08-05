const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  decodeDepthIndex,
  INPUT_HEIGHT,
} = require('../electron/rtmw3d.cjs');
const {
  extractJson,
  buildSystemPrompt,
} = require('../electron/textMotion.cjs');

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

const fenced = extractJson('```json\n{"duration":4,"frames":[{},{}]}\n```');
assert.equal(fenced.duration, 4, 'O parser precisa aceitar JSON envolvido em markdown.');
const surrounded = extractJson('resultado: {"duration":3,"frames":[{},{}]} fim');
assert.equal(surrounded.duration, 3, 'O parser precisa extrair um objeto JSON balanceado.');
const prompt = buildSystemPrompt({
  availableBones: ['hips', 'leftUpperArm', 'rightUpperArm'],
  fps: 30,
  requestedDuration: 5,
  requestedLoop: true,
  style: 'Natural',
  intensity: 50,
});
assert.ok(prompt.includes('Use exatamente 5.00 segundos.'), 'A duração escolhida precisa entrar no contrato do LLM.');
assert.ok(prompt.includes('loop contínuo'), 'O contrato precisa explicitar fechamento de loop.');
assert.ok(!prompt.includes('leftLowerLeg,'), 'O prompt deve anunciar somente ossos disponíveis quando recebidos.');

const rendererStudioPath = path.join(__dirname, '..', 'src', 'components', 'TextMotionStudio.tsx');
const rendererStudio = fs.readFileSync(rendererStudioPath, 'utf8');
assert.ok(!rendererStudio.includes('localStorage'), 'Chaves e configurações do gerador não podem usar localStorage.');
assert.ok(!rendererStudio.includes('Authorization'), 'O renderer não pode montar cabeçalhos de autenticação.');

console.log('RTMW3D, retargeting e text-to-motion: validação concluída.');
