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
  'src/lib/builtinMotions.ts',
  'src/components/BuiltinMotionLibrary.tsx',
  'src/builtin-motion-library.css',
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
assert.ok(!combined.includes('BuiltinMotion'), 'Hand-authored built-in motion components must stay removed.');
assert.ok(!combined.includes('builtin-motion'), 'Hand-authored built-in motion styles must stay removed.');

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
assert.equal(packageJson.dependencies['@pixiv/three-vrm-animation'], '3.5.5');
assert.equal(packageJson.dependencies.fflate, '0.8.2', 'PMP and MMD ZIP inspection requires deterministic ZIP support.');
assert.equal(packageJson.dependencies['three-mmd-runtime'], 'npm:three@0.171.0', 'MMD support must pin the final official legacy Three runtime.');

const requiredFiles = [
  'src/lib/vrmaImporter.ts',
  'src/lib/vrmaExporter.ts',
  'src/lib/motionImporter.ts',
  'src/lib/motionFormats.ts',
  'src/lib/motionLibrary.ts',
  'src/components/MotionLibraryStudio.tsx',
  'src/components/VrmMetaVersionProbe.tsx',
  'src/lib/poseLibrary.ts',
  'src/components/PersonalPoseLibrary.tsx',
  'src/personal-pose-library.css',
  'src/mmd-runtime.d.ts',
  'src/lib/mmdHumanoid.ts',
  'src/lib/mmdModelLoader.ts',
  'src/lib/mmdMotionRetargeter.ts',
  'src/components/MmdStudio.tsx',
  'src/mmd-studio.css',
];
for (const relativePath of requiredFiles) {
  assert.ok(fs.existsSync(path.join(__dirname, '..', relativePath)), `${relativePath} must exist.`);
}

const constants = fs.readFileSync(path.join(__dirname, '..', 'src', 'constants.ts'), 'utf8');
assert.ok(constants.includes("{ id: 'tpose'"), 'The safe T-pose reset must remain available.');
for (const brokenPreset of ["id: 'relaxed'", "id: 'wave'", "id: 'hero'", "id: 'cute'", "id: 'sit'"]) {
  assert.ok(!constants.includes(brokenPreset), `Broken hard-coded preset ${brokenPreset} must stay removed from the UI.`);
}

const poseLibrary = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'poseLibrary.ts'), 'utf8');
assert.ok(poseLibrary.includes("DB_NAME = 'vrm-pose-mode-pose-library'"), 'Personal poses must persist locally.');
assert.ok(poseLibrary.includes("type: 'pose'"), 'Exported pose files must have an explicit document type.');
assert.ok(poseLibrary.includes('validatePoseSnapshot'), 'Imported pose files must be validated before use.');

const personalPoseUi = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'PersonalPoseLibrary.tsx'), 'utf8');
assert.ok(personalPoseUi.includes('Salve primeiro um keyframe'), 'The pose library must require a real captured keyframe instead of invented angles.');
assert.ok(personalPoseUi.includes('structuredClone(selected.pose)'), 'Saved normalized poses must be applied without mutating the library record.');
assert.ok(personalPoseUi.includes('.vrmpose.pose.json'), 'Personal poses must support a dedicated export file.');

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

const mmdLoader = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'mmdModelLoader.ts'), 'utf8');
assert.ok(mmdLoader.includes("from 'three-mmd-runtime/examples/jsm/loaders/MMDLoader.js'"), 'PMX/PMD must use the official legacy MMDLoader implementation.');
assert.ok(mmdLoader.includes("/\\.(pmx|pmd)$/i"), 'The source bundle must require PMX or PMD.');
assert.ok(mmdLoader.includes('unzipSync'), 'ZIP-packaged MMD models must be supported.');
assert.ok(mmdLoader.includes('manager.setURLModifier'), 'MMD texture paths must resolve through the selected local bundle.');
assert.ok(mmdLoader.includes('loadVPD'), 'VPD poses must use the MMD parser.');

const mmdMapping = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'mmdHumanoid.ts'), 'utf8');
for (const standardBone of ['下半身', '上半身', '左腕', '左ひじ', '左手首', '左足', '左ひざ', '左足首']) {
  assert.ok(mmdMapping.includes(standardBone), `Standard MMD bone ${standardBone} must be mapped.`);
}

const mmdRetargeter = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'mmdMotionRetargeter.ts'), 'utf8');
assert.ok(mmdRetargeter.includes('new MMDAnimationHelper'), 'VMD conversion must evaluate MMD IK and grants.');
assert.ok(mmdRetargeter.includes('physics: false'), 'Hair and cloth physics must not contaminate body VRMA conversion.');
assert.ok(mmdRetargeter.includes('current.multiply(state.worldRotation.clone().invert())'), 'MMD retargeting must use source rest-pose deltas.');
assert.ok(mmdRetargeter.includes("sourceFormat: 'VPD'"), 'VPD must compile into a static VRM pose timeline.');
assert.ok(mmdRetargeter.includes('MAX_KEYFRAMES = 12000'), 'MMD conversion must have a hard timeline limit.');

const mmdUi = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'MmdStudio.tsx'), 'utf8');
assert.ok(mmdUi.includes('accept=".vmd,.vpd"'), 'The MMD studio must accept VMD and VPD.');
assert.ok(mmdUi.includes('accept=".pmx,.pmd,.zip'), 'The MMD studio must accept PMX, PMD and model ZIP bundles.');
assert.ok(mmdUi.includes("modelInfo?.format !== 'VRM'"), 'MMD motion conversion must require a VRM destination.');
assert.ok(mmdUi.includes('Pasta completa'), 'The studio must support selecting companion textures from a folder.');

const rendererMain = fs.readFileSync(rendererPath, 'utf8');
assert.ok(rendererMain.includes('<VrmMetaVersionProbe />'), 'VRM version detection must be mounted before the editor.');
assert.ok(rendererMain.includes('<MotionLibraryStudio />'), 'The motion library must be mounted.');
assert.ok(rendererMain.includes('<MmdStudio />'), 'The MMD model and motion studio must be mounted.');
assert.ok(rendererMain.includes('<PersonalPoseLibrary />'), 'The personal pose library must be mounted.');
assert.ok(rendererMain.includes("'./motion-library-formats.css'"), 'Multi-format UI styles must be loaded.');
assert.ok(rendererMain.includes("'./mmd-studio.css'"), 'MMD studio styles must be loaded.');
assert.ok(rendererMain.includes("'./personal-pose-library.css'"), 'Personal pose library styles must be loaded.');

console.log('RTMW3D, VRM axes, multi-format import, MMD PMX/PMD/VMD/VPD and pose library validation completed.');
