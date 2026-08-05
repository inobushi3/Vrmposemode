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
  inferRequestedActions,
  ensureActionCoverage,
} = require('../electron/textMotion.cjs');

function almostEqual(actual, expected, epsilon = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `Esperado ${expected}, recebido ${actual}`);
}

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

const requested = inferRequestedActions('Dê 2 passos para frente e depois faça uma pose de herói.');
assert.equal(requested.length, 2, 'As duas ações explícitas precisam ser reconhecidas.');
assert.deepEqual(requested[0], { type: 'walk', steps: 2, direction: 'forward' });
assert.deepEqual(requested[1], { type: 'heroPose' });
const covered = ensureActionCoverage({ duration: 4, actions: [] }, 'Dê 2 passos para frente e depois faça uma pose heroica.');
assert.deepEqual(covered.actions.map((action) => action.type), ['walk', 'heroPose']);

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
assert.ok(prompt.includes('forward = +Z'), 'O contrato precisa fixar a direção frontal oficial do VRM.');
assert.ok(prompt.includes('normalizedHumanBones'), 'O contrato precisa usar o humanoide normalizado do VRM.');
assert.ok(!prompt.includes('leftLowerLeg, rightLowerLeg'), 'O prompt deve anunciar somente ossos disponíveis quando recebidos.');

const proceduralPath = path.join(__dirname, '..', 'src', 'lib', 'proceduralMotion.ts');
const procedural = fs.readFileSync(proceduralPath, 'utf8');
assert.ok(procedural.includes("if (direction === 'backward') return [0, 0, -1];"));
assert.ok(procedural.includes("return [0, 0, 1];"), 'Caminhar para frente precisa aumentar Z.');
assert.ok(procedural.includes("if (action.type === 'heroPose')"), 'A pose heroica precisa ter compilador determinístico.');
assert.ok(procedural.includes('steps: clamp'), 'A quantidade de passos precisa ser preservada e limitada.');

const rendererStudioPath = path.join(__dirname, '..', 'src', 'components', 'TextMotionStudio.tsx');
const rendererStudio = fs.readFileSync(rendererStudioPath, 'utf8');
assert.ok(!rendererStudio.includes('localStorage'), 'Chaves e configurações do gerador não podem usar localStorage.');
assert.ok(!rendererStudio.includes('Authorization'), 'O renderer não pode montar cabeçalhos de autenticação.');

console.log('RTMW3D, retargeting e motor semântico de movimento: validação concluída.');
