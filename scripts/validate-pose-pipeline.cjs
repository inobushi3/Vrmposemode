const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  decodeDepthIndex,
  INPUT_HEIGHT,
} = require('../electron/rtmw3d.cjs');

function almostEqual(actual, expected, epsilon = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${expected}, received ${actual}`);
}

almostEqual(decodeDepthIndex(INPUT_HEIGHT), 0);
assert.ok(decodeDepthIndex(0) < 0, 'The beginning of the Z axis must be behind the center.');
assert.ok(decodeDepthIndex(INPUT_HEIGHT * 2) > 0, 'The end of the Z axis must be in front of the center.');

const retargeterPath = path.join(__dirname, '..', 'src', 'lib', 'poseRetargeter.ts');
const retargeter = fs.readFileSync(retargeterPath, 'utf8');
assert.ok(
  retargeter.includes('if (!prior) return safeScore > 0.001 ? next : IDENTITY.clone();'),
  'The first valid pose must not be discarded by the confidence threshold.',
);
assert.ok(
  !retargeter.includes('if (score >= threshold) return candidate.normalize();'),
  'The obsolete first-frame confidence gate must not return.',
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
  assert.ok(!fs.existsSync(path.join(__dirname, '..', relativePath)), `${relativePath} must stay removed.`);
}

const mainPath = path.join(__dirname, '..', 'electron', 'main.cjs');
const preloadPath = path.join(__dirname, '..', 'electron', 'preload.cjs');
const rendererPath = path.join(__dirname, '..', 'src', 'main.tsx');
const combined = [mainPath, preloadPath, rendererPath]
  .map((filePath) => fs.readFileSync(filePath, 'utf8'))
  .join('\n');
assert.ok(!combined.includes('text-motion'), 'Text-motion IPC channels must stay removed.');
assert.ok(!combined.includes('TextMotion'), 'Text-motion components and services must stay removed.');

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
assert.equal(packageJson.dependencies['@pixiv/three-vrm-animation'], '3.5.5');
assert.equal(packageJson.dependencies.fflate, '0.8.2', 'PMP inspection requires deterministic ZIP support.');

const requiredFiles = [
  'src/lib/vrmaImporter.ts',
  'src/lib/vrmaExporter.ts',
  'src/lib/motionImporter.ts',
  'src/lib/motionFormats.ts',
  'src/lib/motionLibrary.ts',
  'src/components/MotionLibraryStudio.tsx',
  'src/components/VrmMetaVersionProbe.tsx',
];
for (const relativePath of requiredFiles) {
  assert.ok(fs.existsSync(path.join(__dirname, '..', relativePath)), `${relativePath} must exist.`);
}

const vrmaImporter = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'vrmaImporter.ts'), 'utf8');
assert.ok(vrmaImporter.includes('new VRMAnimationLoaderPlugin(parser)'), 'VRMA must use the official loader plugin.');
assert.ok(vrmaImporter.includes('Number(value[0]) - rest.x'), 'VRMA hips translation must become T-pose-relative motion.');
assert.ok(vrmaImporter.includes("targetMetaVersion === '0' ? -1 : 1"), 'VRM0 hips X/Z axes must be inverted during import.');
assert.ok(vrmaImporter.includes('(vrm0 ? -1 : 1)'), 'VRM0 quaternion X/Z components must follow the official conversion.');
assert.ok(vrmaImporter.includes('modelInfo?.metaVersion'), 'VRMA import must use the loaded target VRM version.');

const vrmaExporter = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'vrmaExporter.ts'), 'utf8');
assert.ok(vrmaExporter.includes('return [-normalized[0], normalized[1], -normalized[2], normalized[3]]'), 'VRM0 rotations must return to canonical VRMA axes on export.');
assert.ok(vrmaExporter.includes('return [-position[0], position[1], -position[2]]'), 'VRM0 root motion must return to canonical VRMA axes on export.');

const versionProbe = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'VrmMetaVersionProbe.tsx'), 'utf8');
assert.ok(versionProbe.includes("used.has('VRMC_vrm')"), 'The loaded model detector must recognize VRM 1.0.');
assert.ok(versionProbe.includes("used.has('VRM')"), 'The loaded model detector must recognize VRM 0.x.');

const motionImporter = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'motionImporter.ts'), 'utf8');
assert.ok(motionImporter.includes('new BVHLoader().parse'), 'BVH support must remain enabled.');
assert.ok(motionImporter.includes('new FBXLoader().parse'), 'FBX support must remain enabled.');
assert.ok(motionImporter.includes('loader.parseAsync'), 'GLB/glTF support must remain enabled.');
assert.ok(motionImporter.includes("format === 'pmp'"), 'PMP packages must be recognized.');
assert.ok(motionImporter.includes('proprietary Havok'), 'PAP must be blocked with an explicit proprietary-format diagnostic.');
assert.ok(motionImporter.includes('currentWorld.multiply(state.restWorldRotation.clone().invert())'), 'Retargeting must use animation deltas from the source rest pose.');
assert.ok(motionImporter.includes('MAX_KEYFRAMES = 12000'), 'Imported timelines must have a hard size limit.');

const motionLibrary = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'motionLibrary.ts'), 'utf8');
assert.ok(motionLibrary.includes('DB_VERSION = 2'), 'The motion library schema must include the source format.');
assert.ok(motionLibrary.includes('indexedDB.open(DB_NAME, DB_VERSION)'), 'The motion library must persist locally.');

const rendererMain = fs.readFileSync(rendererPath, 'utf8');
assert.ok(rendererMain.includes('<VrmMetaVersionProbe />'), 'VRM version detection must be mounted before the editor.');
assert.ok(rendererMain.includes('<MotionLibraryStudio />'), 'The motion library must be mounted.');
assert.ok(rendererMain.includes("'./motion-library-formats.css'"), 'Multi-format UI styles must be loaded.');

console.log('RTMW3D, retargeting, VRM axis conversion and multi-format motion import validation completed.');
