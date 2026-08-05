const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decodeDepthIndex, INPUT_HEIGHT } = require('../electron/rtmw3d.cjs');
const { parsePap, parseSklb, XAT_DOWNLOAD_URL } = require('../electron/papConverter.cjs');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

function almostEqual(actual, expected, epsilon = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${expected}, received ${actual}`);
}

almostEqual(decodeDepthIndex(INPUT_HEIGHT), 0);
assert.ok(decodeDepthIndex(0) < 0, 'The beginning of the Z axis must be behind the center.');
assert.ok(decodeDepthIndex(INPUT_HEIGHT * 2) > 0, 'The end of the Z axis must be in front of the center.');

const retargeter = read('src/lib/poseRetargeter.ts');
assert.ok(retargeter.includes('if (!prior) return safeScore > 0.001 ? next : IDENTITY.clone();'));
assert.ok(!retargeter.includes('if (score >= threshold) return candidate.normalize();'));

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
for (const relativePath of removedPaths) assert.ok(!exists(relativePath), `${relativePath} must stay removed.`);

const rendererPath = 'src/main.tsx';
const combined = [read('electron/main.cjs'), read('electron/preload.cjs'), read(rendererPath)].join('\n');
assert.ok(!combined.includes('text-motion'));
assert.ok(!combined.includes('TextMotion'));
assert.ok(!combined.includes('BuiltinMotion'));
assert.ok(!combined.includes('builtin-motion'));

const packageJson = JSON.parse(read('package.json'));
assert.equal(packageJson.dependencies['@pixiv/three-vrm-animation'], '3.5.5');
assert.equal(packageJson.dependencies.fflate, '0.8.2');
assert.equal(packageJson.dependencies['three-mmd-runtime'], 'npm:three@0.171.0');

const requiredFiles = [
  'electron/papConverter.cjs',
  'src/lib/papPackage.ts',
  'src/lib/vrmaImporter.ts',
  'src/lib/vrmaExporter.ts',
  'src/lib/motionImporter.ts',
  'src/components/MotionLibraryStudio.tsx',
  'src/components/VrmMetaVersionProbe.tsx',
  'src/lib/poseLibrary.ts',
  'src/components/PersonalPoseLibrary.tsx',
  'src/mmd-runtime.d.ts',
  'src/lib/mmdHumanoid.ts',
  'src/lib/mmdModelLoader.ts',
  'src/lib/mmdMotionRetargeter.ts',
  'src/lib/mmdVmdParser.ts',
  'src/components/MmdStudio.tsx',
  'src/mmd-studio.css',
  'src/mmd-motion-package.css',
];
for (const relativePath of requiredFiles) assert.ok(exists(relativePath), `${relativePath} must exist.`);

const syntheticPap = Buffer.alloc(74);
syntheticPap.write('pap ', 0, 'ascii');
syntheticPap.writeInt32LE(0x00020001, 4);
syntheticPap.writeInt16LE(1, 8);
syntheticPap.writeInt32LE(101, 10);
syntheticPap.writeInt32LE(26, 14);
syntheticPap.writeInt32LE(66, 18);
syntheticPap.writeInt32LE(70, 22);
syntheticPap.write('dance_loop', 26, 'ascii');
syntheticPap.writeInt16LE(0, 58);
syntheticPap.writeInt16LE(2, 60);
syntheticPap.writeInt32LE(0, 62);
syntheticPap.set([1, 2, 3, 4], 66);
const parsedPap = parsePap(syntheticPap);
assert.equal(parsedPap.skeletonId, 101);
assert.equal(parsedPap.animations.length, 1);
assert.equal(parsedPap.animations[0].name, 'dance_loop');
assert.equal(parsedPap.animations[0].havokIndex, 2);
assert.deepEqual([...parsedPap.havokData], [1, 2, 3, 4]);

const syntheticSklb = Buffer.alloc(52);
syntheticSklb.write('blks', 0, 'ascii');
syntheticSklb.writeInt16LE(0, 4);
syntheticSklb.writeInt16LE(0x3133, 6);
syntheticSklb.writeUInt32LE(40, 8);
syntheticSklb.writeUInt32LE(44, 12);
syntheticSklb.writeInt32LE(0, 16);
syntheticSklb.writeInt32LE(101, 20);
syntheticSklb.set([9, 8, 7, 6, 5, 4, 3, 2], 44);
const parsedSklb = parseSklb(syntheticSklb);
assert.equal(parsedSklb.skeletonId, 101);
assert.equal(parsedSklb.oldHeader, false);
assert.deepEqual([...parsedSklb.havokData], [9, 8, 7, 6, 5, 4, 3, 2]);
assert.equal(XAT_DOWNLOAD_URL, 'https://github.com/Etheirys/XAT/releases/latest/download/XAT.zip');

const papService = read('electron/papConverter.cjs');
assert.ok(papService.includes("['createContainer', container]"));
assert.ok(papService.includes("['addSkeleton', container, skeletonHavok, '0', container]"));
assert.ok(papService.includes("['addAnimation', container, animationHavok"));
assert.ok(papService.includes("['toFbxAnimation', container, '0', '0', outputFbx]"));
assert.ok(papService.includes('XATHavokInterop.exe'));
assert.ok(papService.includes('Visual C++ Redistributable 2012 x86'));

const constants = read('src/constants.ts');
assert.ok(constants.includes("{ id: 'tpose'"));
for (const brokenPreset of ["id: 'relaxed'", "id: 'wave'", "id: 'hero'", "id: 'cute'", "id: 'sit'"]) {
  assert.ok(!constants.includes(brokenPreset), `Broken hard-coded preset ${brokenPreset} must stay removed.`);
}

const types = read('src/types.ts');
assert.ok(types.includes('export type ExpressionSnapshot'));
assert.ok(types.includes('expressions?: ExpressionSnapshot'));
assert.ok(types.includes('availableExpressions?: string[]'));
assert.ok(types.includes('export interface HumanoidRigSnapshot'));

const viewport = read('src/components/Viewport.tsx');
assert.ok(viewport.includes('manager.setValue(name'));
assert.ok(viewport.includes('manager.resetValues()'));
assert.ok(viewport.includes('availableExpressions'));
assert.ok(viewport.includes('frame.expressions'));

const vrmaImporter = read('src/lib/vrmaImporter.ts');
assert.ok(vrmaImporter.includes('new VRMAnimationLoaderPlugin(parser)'));
assert.ok(vrmaImporter.includes('animation.expressionTracks.preset'));
assert.ok(vrmaImporter.includes('animation.expressionTracks.custom'));
assert.ok(vrmaImporter.includes('expressions[name]'));
assert.ok(vrmaImporter.includes("targetMetaVersion === '0' ? -1 : 1"));

const vrmaExporter = read('src/lib/vrmaExporter.ts');
assert.ok(vrmaExporter.includes('EXPRESSION_PRESETS'));
assert.ok(vrmaExporter.includes('expressionPreset'));
assert.ok(vrmaExporter.includes('expressionCustom'));
assert.ok(vrmaExporter.includes("target: { node: nodeIndex, path: 'translation' }"));
assert.ok(vrmaExporter.includes('return [-normalized[0], normalized[1], -normalized[2], normalized[3]]'));
assert.ok(vrmaExporter.includes('return [-position[0], position[1], -position[2]]'));

const motionImporter = read('src/lib/motionImporter.ts');
assert.ok(motionImporter.includes('new BVHLoader().parse'));
assert.ok(motionImporter.includes('new FBXLoader().parse'));
assert.ok(motionImporter.includes('loader.parseAsync'));
assert.ok(motionImporter.includes("format === 'pmp'"));
assert.ok(motionImporter.includes('MAX_KEYFRAMES = 12000'));
assert.ok(motionImporter.includes("targetMetaVersion?: '0' | '1'"));
assert.ok(motionImporter.includes('ROOT_CONTROL_NAMES'));
assert.ok(motionImporter.includes("'n_root'"));
assert.ok(motionImporter.includes("'n_hara'"));
assert.ok(motionImporter.includes('findRootMotionSource'));
assert.ok(motionImporter.includes('rootMotionSource.node.getWorldPosition'));
assert.ok(motionImporter.includes("targetMetaVersion === '0'"));
assert.ok(motionImporter.includes("hips: ['hips', 'hip', 'pelvis', 'j_kosi']"));
assert.ok(!motionImporter.includes("hips: ['hips', 'hip', 'pelvis', 'root'"));

const papPackage = read('src/lib/papPackage.ts');
assert.ok(papPackage.includes('parsePapBytes'));
assert.ok(papPackage.includes('listPmpPapEntries'));
assert.ok(papPackage.includes('extractPmpPap'));
assert.ok(papPackage.includes('/(?:^|\\/)(c\\d{4})(?:\\/|_)/'));

const motionUi = read('src/components/MotionLibraryStudio.tsx');
assert.ok(motionUi.includes('Selecionar ${expectedSklbName}'));
assert.ok(motionUi.includes('bridge.convert'));
assert.ok(motionUi.includes('Converter PAP para timeline'));
assert.ok(motionUi.includes('Preparar conversor XAT'));
assert.ok(motionUi.includes('extractPmpPap'));
assert.ok(motionUi.includes('targetMetaVersion: modelInfo.metaVersion'));
assert.ok(motionUi.includes('O app não está processando nada agora.'));
assert.ok(motionUi.includes("['download', 'extract', 'convert'].includes"));
assert.ok(motionUi.includes('separa o motion root do quadril anatômico'));

const motionCss = read('src/motion-library-formats.css');
assert.ok(motionCss.includes('.motion-pap-waiting'));
assert.ok(motionCss.includes('.motion-pap-waiting.ready'));

const electronMain = read('electron/main.cjs');
const preload = read('electron/preload.cjs');
assert.ok(electronMain.includes("ipcMain.handle('pap:convert'"));
assert.ok(electronMain.includes('new PapConverterService'));
assert.ok(preload.includes("ipcRenderer.invoke('pap:convert'"));
assert.ok(preload.includes("ipcRenderer.on('pap:progress'"));

const mmdLoader = read('src/lib/mmdModelLoader.ts');
assert.ok(mmdLoader.includes("from 'three-mmd-runtime/examples/jsm/loaders/MMDLoader.js'"));
assert.ok(mmdLoader.includes('unzipSync'));
assert.ok(mmdLoader.includes('manager.setURLModifier'));
assert.ok(mmdLoader.includes('.sort((a, b) => b.size - a.size)'));
assert.ok(mmdLoader.includes('loadVPD'));

const mmdMapping = read('src/lib/mmdHumanoid.ts');
for (const standardBone of ['下半身', '上半身', '左腕', '左ひじ', '左手首', '左足', '左ひざ', '左足首']) {
  assert.ok(mmdMapping.includes(standardBone), `Standard MMD bone ${standardBone} must be mapped.`);
}

const vmdParser = read('src/lib/mmdVmdParser.ts');
assert.ok(vmdParser.includes("header.startsWith('Vocaloid Motion Data')"));
assert.ok(vmdParser.includes('boneFrames = new Map'));
assert.ok(vmdParser.includes('maximumFrame = Math.max(maximumFrame, frame)'));
assert.ok(vmdParser.includes('sampleVmdBoneTrack'));
assert.ok(vmdParser.includes('cubicBezierWeight'));
assert.ok(vmdParser.includes('MMD is left-handed'));
assert.ok(vmdParser.includes('morphFrameCount'));
assert.ok(vmdParser.includes("json.dataType !== 'VMDMorph'"));
assert.ok(vmdParser.includes('expandMmdMotionSelection'));
assert.ok(vmdParser.includes("['aa']"));
assert.ok(vmdParser.includes("['blink']"));
assert.ok(vmdParser.includes('sampleMmdExpressions'));

const mmdRetargeter = read('src/lib/mmdMotionRetargeter.ts');
assert.ok(mmdRetargeter.includes('new MMDAnimationHelper'));
assert.ok(mmdRetargeter.includes('physics: false'));
assert.ok(mmdRetargeter.includes('current.multiply(state.worldRotation.clone().invert())'));
assert.ok(mmdRetargeter.includes('retargetMorphOnlyVmd'));
assert.ok(mmdRetargeter.includes('retargetDirectVmd'));
assert.ok(mmdRetargeter.includes('sampleRootControls'));
assert.ok(mmdRetargeter.includes('solveDirectLegIk'));
assert.ok(mmdRetargeter.includes('return retargetDirectVmd(parsed, options)'));
assert.ok(mmdRetargeter.includes('VMD convertido diretamente pelos nomes de ossos MMD padrão'));
assert.ok(mmdRetargeter.includes('expressions: sampleMmdExpressions'));
assert.ok(mmdRetargeter.includes("sourceFormat: 'VPD'"));
assert.ok(mmdRetargeter.includes('MAX_KEYFRAMES = 12000'));

const mmdUi = read('src/components/MmdStudio.tsx');
assert.ok(mmdUi.includes('accept=".vmd,.vpd,.zip,.json,.txt"'));
assert.ok(mmdUi.includes('accept=".pmx,.pmd,.zip'));
assert.ok(mmdUi.includes('expandMmdMotionSelection'));
assert.ok(mmdUi.includes('VMD facial/lip'));
assert.ok(mmdUi.includes('availableExpressions: modelInfo.availableExpressions'));
assert.ok(mmdUi.includes('targetRig: modelInfo.humanoidRig'));
assert.ok(mmdUi.includes("sourceModelRequired = Boolean(motionFile && /\\.vpd$/i"));
assert.ok(mmdUi.includes('Modo direto no VRM'));
assert.ok(mmdUi.includes('VMD → VRM direto'));
assert.ok(mmdUi.includes('renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25))'));
assert.ok(mmdUi.includes('controls.enableDamping = false'));
assert.ok(mmdUi.includes("controls.addEventListener('change', requestRender)"));
assert.ok(!mmdUi.includes('requestAnimationFrame(render);'));
assert.ok(mmdUi.includes('Pasta completa'));

const rendererMain = read(rendererPath);
assert.ok(rendererMain.includes('<VrmMetaVersionProbe />'));
assert.ok(rendererMain.includes('<MotionLibraryStudio />'));
assert.ok(rendererMain.includes('<MmdStudio />'));
assert.ok(rendererMain.includes('<PersonalPoseLibrary />'));
assert.ok(rendererMain.includes("'./mmd-motion-package.css'"));

console.log('RTMW3D, VRM axes, PAP/SKLB/XAT, direct VMD to VRM, economical MMD preview, facial expressions and multi-format import validation completed.');
