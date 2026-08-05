const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  decodeDepthIndex,
  INPUT_HEIGHT,
} = require('../electron/rtmw3d.cjs');

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

const removedPaths = [
  'electron/textMotion.cjs',
  'src/components/TextMotionStudio.tsx',
  'src/lib/textMotion.ts',
  'src/lib/textMotionCompiler.ts',
  'src/lib/proceduralMotion.ts',
  'src/lib/vrmSemanticMotion.ts',
  'src/text-motion-studio.css',
  'THIRD_PARTY_NOTICES.md',
];
for (const relativePath of removedPaths) {
  assert.ok(
    !fs.existsSync(path.join(__dirname, '..', relativePath)),
    `${relativePath} não pode voltar ao projeto.`,
  );
}

const mainPath = path.join(__dirname, '..', 'electron', 'main.cjs');
const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');
const rendererPath = path.join(__dirname, '..', 'src', 'main.tsx');
const combined = [mainPath, preloadPath, rendererPath]
  .map((filePath) => fs.readFileSync(filePath, 'utf8'))
  .join('\n');
assert.ok(!combined.includes('text-motion'), 'Canais IPC de geração por texto não podem permanecer.');
assert.ok(!combined.includes('TextMotion'), 'Componentes e serviços de geração por texto não podem permanecer.');

console.log('RTMW3D e retargeting: validação concluída; geração por texto removida.');
