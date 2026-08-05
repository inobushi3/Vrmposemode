import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { HUMAN_BONES } from '../constants';
import { useEditorStore } from '../store';
import type {
  BonePose,
  ExpressionSnapshot,
  PoseSnapshot,
  QuatTuple,
  Vec3Tuple,
} from '../types';
import { editorEvent } from '../lib/events';
import { exportVrma } from '../lib/vrmaExporter';

interface SceneRuntime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  orbit: OrbitControls;
  transform: TransformControls;
  clock: THREE.Clock;
  grid: THREE.GridHelper;
  helpers: THREE.Group;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
}

interface LoadedModel {
  root: THREE.Object3D;
  vrm: VRM | null;
  bones: Map<string, THREE.Object3D>;
  handles: Map<string, THREE.Mesh>;
  fileName: string;
}

interface InterpolatedFrame {
  pose: PoseSnapshot;
  expressions: ExpressionSnapshot;
}

const DEG = THREE.MathUtils.RAD2DEG;
const RAD = THREE.MathUtils.DEG2RAD;

function tupleQuat(value: unknown): QuatTuple {
  if (Array.isArray(value) && value.length >= 4) {
    return [Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3])];
  }
  return [0, 0, 0, 1];
}

function tupleVec(value: unknown): Vec3Tuple {
  if (Array.isArray(value) && value.length >= 3) {
    return [Number(value[0]), Number(value[1]), Number(value[2])];
  }
  return [0, 0, 0];
}

function safeName(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'animation';
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function expressionNames(vrm: VRM | null): string[] {
  const manager = vrm?.expressionManager;
  if (!manager) return [];
  const map = manager.expressionMap as Record<string, unknown> | undefined;
  const names = map ? Object.keys(map) : [];
  if (names.length) return names.sort();
  return manager.expressions.map((expression) => expression.expressionName).sort();
}

export default function Viewport(): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const modelRef = useRef<LoadedModel | null>(null);
  const animationFrameRef = useRef<number>(0);
  const lastPlaybackRef = useRef<number>(performance.now());

  const selectedBone = useEditorStore((state) => state.selectedBone);
  const gizmoMode = useEditorStore((state) => state.gizmoMode);
  const showGrid = useEditorStore((state) => state.showGrid);
  const showHandles = useEditorStore((state) => state.showHandles);
  const background = useEditorStore((state) => state.background);
  const modelInfo = useEditorStore((state) => state.modelInfo);

  const updateSelectedTransform = (): void => {
    const model = modelRef.current;
    const boneName = useEditorStore.getState().selectedBone;
    const node = boneName ? model?.bones.get(boneName) : null;
    if (!node) return;
    useEditorStore.getState().setSelectedTransform({
      rotation: [node.rotation.x * DEG, node.rotation.y * DEG, node.rotation.z * DEG],
      position: [node.position.x, node.position.y, node.position.z],
    });
  };

  const capturePose = (): PoseSnapshot => {
    const model = modelRef.current;
    if (!model) return {};
    const pose: PoseSnapshot = {};
    if (model.vrm) {
      const normalized = model.vrm.humanoid.getNormalizedPose() as Record<string, { rotation?: unknown; position?: unknown }>;
      for (const bone of useEditorStore.getState().availableBones) {
        pose[bone] = {
          rotation: tupleQuat(normalized[bone]?.rotation),
          ...(bone === 'hips' ? { position: tupleVec(normalized[bone]?.position) } : {}),
        };
      }
      return pose;
    }
    for (const [name, node] of model.bones) {
      pose[name] = {
        rotation: node.quaternion.toArray() as QuatTuple,
        ...(name === 'hips' ? { position: node.position.toArray() as Vec3Tuple } : {}),
      };
    }
    return pose;
  };

  const captureExpressions = (): ExpressionSnapshot => {
    const manager = modelRef.current?.vrm?.expressionManager;
    if (!manager) return {};
    const result: ExpressionSnapshot = {};
    for (const name of expressionNames(modelRef.current?.vrm ?? null)) {
      const value = manager.getValue(name);
      if (value != null && Math.abs(value) > 0.000001) result[name] = Math.max(0, Math.min(1, value));
    }
    return result;
  };

  const applyPose = (pose: PoseSnapshot): void => {
    const model = modelRef.current;
    if (!model) return;
    if (model.vrm) {
      model.vrm.humanoid.resetNormalizedPose();
      model.vrm.humanoid.setNormalizedPose(pose as never);
      model.vrm.humanoid.update();
    } else {
      for (const [name, value] of Object.entries(pose)) {
        const node = model.bones.get(name);
        if (!node) continue;
        node.quaternion.fromArray(value.rotation);
        if (value.position && name === 'hips') node.position.fromArray(value.position);
      }
    }
    updateSelectedTransform();
  };

  const applyExpressions = (expressions: ExpressionSnapshot): void => {
    const manager = modelRef.current?.vrm?.expressionManager;
    if (!manager) return;
    manager.resetValues();
    for (const [name, rawValue] of Object.entries(expressions)) {
      if (manager.getExpression(name) == null) continue;
      manager.setValue(name, Math.max(0, Math.min(1, Number(rawValue) || 0)));
    }
    manager.update();
  };

  const interpolateFrame = (time: number): InterpolatedFrame | null => {
    const frames = useEditorStore.getState().keyframes;
    if (!frames.length) return null;
    if (time <= frames[0].time) {
      return { pose: frames[0].pose, expressions: frames[0].expressions ?? {} };
    }
    if (time >= frames[frames.length - 1].time) {
      const last = frames[frames.length - 1];
      return { pose: last.pose, expressions: last.expressions ?? {} };
    }

    let left = frames[0];
    let right = frames[frames.length - 1];
    for (let index = 0; index < frames.length - 1; index += 1) {
      if (time >= frames[index].time && time <= frames[index + 1].time) {
        left = frames[index];
        right = frames[index + 1];
        break;
      }
    }

    const span = Math.max(0.00001, right.time - left.time);
    let alpha = Math.max(0, Math.min(1, (time - left.time) / span));
    if (left.easing === 'step') alpha = 0;
    if (left.easing === 'smooth') alpha = alpha * alpha * (3 - 2 * alpha);

    const pose: PoseSnapshot = {};
    const boneNames = new Set([...Object.keys(left.pose), ...Object.keys(right.pose)]);
    for (const name of boneNames) {
      const a = left.pose[name] ?? right.pose[name];
      const b = right.pose[name] ?? left.pose[name];
      if (!a || !b) continue;
      const qa = new THREE.Quaternion().fromArray(a.rotation);
      const qb = new THREE.Quaternion().fromArray(b.rotation);
      qa.slerp(qb, alpha);
      const value: BonePose = { rotation: qa.toArray() as QuatTuple };
      if (a.position || b.position) {
        const pa = new THREE.Vector3().fromArray(a.position ?? [0, 0, 0]);
        const pb = new THREE.Vector3().fromArray(b.position ?? [0, 0, 0]);
        value.position = pa.lerp(pb, alpha).toArray() as Vec3Tuple;
      }
      pose[name] = value;
    }

    const expressions: ExpressionSnapshot = {};
    const expressionSet = new Set([
      ...Object.keys(left.expressions ?? {}),
      ...Object.keys(right.expressions ?? {}),
    ]);
    for (const name of expressionSet) {
      const a = left.expressions?.[name] ?? 0;
      const b = right.expressions?.[name] ?? 0;
      expressions[name] = a + (b - a) * alpha;
    }
    return { pose, expressions };
  };

  const applyAnimationAt = (time: number): void => {
    const frame = interpolateFrame(time);
    if (!frame) return;
    applyPose(frame.pose);
    applyExpressions(frame.expressions);
  };

  const frameCamera = (view: string = 'full'): void => {
    const runtime = runtimeRef.current;
    const model = modelRef.current;
    if (!runtime || !model) return;
    const box = new THREE.Box3().setFromObject(model.root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const height = Math.max(size.y, 1);
    const target = center.clone();
    let position = new THREE.Vector3(center.x, center.y + height * 0.05, center.z + height * 1.45);

    if (view === 'back') position = new THREE.Vector3(center.x, center.y + height * 0.05, center.z - height * 1.45);
    if (view === 'left') position = new THREE.Vector3(center.x - height * 1.45, center.y + height * 0.05, center.z);
    if (view === 'right') position = new THREE.Vector3(center.x + height * 1.45, center.y + height * 0.05, center.z);
    if (view === 'three') position = new THREE.Vector3(center.x + height * 0.9, center.y + height * 0.12, center.z + height * 1.1);
    if (view === 'head') {
      target.y = box.max.y - height * 0.15;
      position = new THREE.Vector3(center.x, target.y, center.z + height * 0.52);
    }

    runtime.camera.position.copy(position);
    runtime.orbit.target.copy(target);
    runtime.orbit.update();
  };

  const clearModel = (): void => {
    const runtime = runtimeRef.current;
    const loaded = modelRef.current;
    if (!runtime || !loaded) return;
    runtime.transform.detach();
    runtime.scene.remove(loaded.root);
    loaded.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
      if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
      else mesh.material?.dispose?.();
    });
    runtime.helpers.clear();
    modelRef.current = null;
  };

  const createHandles = (bones: Map<string, THREE.Object3D>): Map<string, THREE.Mesh> => {
    const runtime = runtimeRef.current!;
    runtime.helpers.clear();
    const handles = new Map<string, THREE.Mesh>();
    const geometry = new THREE.SphereGeometry(0.018, 12, 8);
    for (const [name] of bones) {
      const material = new THREE.MeshBasicMaterial({
        color: name.includes('left') ? 0x8c7cff : name.includes('right') ? 0xff76b9 : 0x72e6ff,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      });
      const handle = new THREE.Mesh(geometry, material);
      handle.renderOrder = 1000;
      handle.userData.boneName = name;
      runtime.helpers.add(handle);
      handles.set(name, handle);
    }
    runtime.helpers.visible = useEditorStore.getState().showHandles;
    return handles;
  };

  const loadModel = async (file: File): Promise<void> => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !['vrm', 'glb', 'gltf'].includes(extension)) {
      useEditorStore.getState().setStatus('Formato não suportado. Use VRM, GLB ou GLTF.');
      return;
    }

    useEditorStore.getState().setStatus(`Carregando ${file.name}…`);
    useEditorStore.getState().setPlaying(false);
    const url = URL.createObjectURL(file);
    try {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync(url);
      clearModel();

      const vrm = (gltf.userData.vrm as VRM | undefined) ?? null;
      const root = vrm?.scene ?? gltf.scene;
      const bones = new Map<string, THREE.Object3D>();

      if (vrm) {
        VRMUtils.rotateVRM0(vrm);
        for (const name of HUMAN_BONES) {
          const node = vrm.humanoid.getNormalizedBoneNode(name);
          if (node) bones.set(name, node);
        }
      } else {
        root.traverse((object) => {
          if ((object as THREE.Bone).isBone && object.name && !bones.has(object.name)) bones.set(object.name, object);
        });
      }

      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
        }
      });
      runtime.scene.add(root);
      const handles = createHandles(bones);
      modelRef.current = { root, vrm, bones, handles, fileName: file.name };

      const meta = vrm?.meta as unknown as Record<string, unknown> | undefined;
      const authors = meta?.authors;
      const author = Array.isArray(authors) ? authors.join(', ') : typeof meta?.author === 'string' ? meta.author : undefined;
      const box = new THREE.Box3().setFromObject(root);
      const heightMeters = Math.max(0.001, box.max.y - box.min.y);
      const availableExpressions = expressionNames(vrm);
      useEditorStore.getState().setModel({
        name: file.name,
        format: extension === 'vrm' ? 'VRM' : extension === 'glb' ? 'GLB' : 'GLTF',
        avatarName: typeof meta?.name === 'string' ? meta.name : undefined,
        author,
        version: typeof meta?.version === 'string' ? meta.version : undefined,
        boneCount: bones.size,
        heightMeters,
        availableExpressions,
      }, file.name);
      useEditorStore.getState().setAvailableBones([...bones.keys()]);
      useEditorStore.getState().selectBone(bones.has('hips') ? 'hips' : bones.keys().next().value ?? null);
      useEditorStore.getState().setStatus(vrm
        ? `${file.name} carregado com ${bones.size} ossos e ${availableExpressions.length} expressões.`
        : `${file.name} carregado. Para exportar VRMA, use um modelo VRM com humanoide.`);
      frameCamera('full');
      if (useEditorStore.getState().keyframes.length) applyAnimationAt(useEditorStore.getState().currentTime);
    } catch (error) {
      console.error(error);
      useEditorStore.getState().setStatus(`Não foi possível abrir ${file.name}. Verifique se o arquivo está íntegro.`);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(useEditorStore.getState().background);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
    camera.position.set(0, 1.25, 3.2);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.target.set(0, 1, 0);
    orbit.minDistance = 0.25;
    orbit.maxDistance = 12;

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode('rotate');
    transform.setSpace('local');
    transform.setSize(0.72);
    scene.add(transform.getHelper());

    const grid = new THREE.GridHelper(20, 40, 0x5e5675, 0x2d283d);
    scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(6, 64),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.18 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.002;
    floor.receiveShadow = true;
    scene.add(floor);

    scene.add(new THREE.HemisphereLight(0xc6d8ff, 0x2a1838, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(2.6, 4.5, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9f80ff, 2.4);
    rim.position.set(-3.5, 2.8, -2.5);
    scene.add(rim);
    const fill = new THREE.PointLight(0xff7ec8, 1.5, 8);
    fill.position.set(-2, 1.5, 2.2);
    scene.add(fill);

    const helpers = new THREE.Group();
    scene.add(helpers);
    runtimeRef.current = {
      scene,
      camera,
      renderer,
      orbit,
      transform,
      clock: new THREE.Clock(),
      grid,
      helpers,
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
    };

    const resize = (): void => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    transform.addEventListener('dragging-changed', (event: THREE.Event & { value?: boolean }) => {
      orbit.enabled = !event.value;
      if (!event.value) {
        updateSelectedTransform();
        useEditorStore.getState().setDirtyPose(true);
      }
    });
    transform.addEventListener('objectChange', () => {
      updateSelectedTransform();
      useEditorStore.getState().setDirtyPose(true);
    });

    const onPointerDown = (event: PointerEvent): void => {
      const rect = renderer.domElement.getBoundingClientRect();
      const runtime = runtimeRef.current;
      const model = modelRef.current;
      if (!runtime || !model || !useEditorStore.getState().showHandles) return;
      runtime.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      runtime.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      runtime.raycaster.setFromCamera(runtime.pointer, camera);
      const hit = runtime.raycaster.intersectObjects([...model.handles.values()], false)[0];
      const name = hit?.object.userData.boneName as string | undefined;
      if (name) {
        useEditorStore.getState().selectBone(name);
        event.stopPropagation();
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    const updateHandles = (): void => {
      const model = modelRef.current;
      if (!model) return;
      for (const [name, handle] of model.handles) {
        const node = model.bones.get(name);
        if (node) node.getWorldPosition(handle.position);
        handle.scale.setScalar(useEditorStore.getState().selectedBone === name ? 1.55 : 1);
      }
    };

    const render = (): void => {
      animationFrameRef.current = requestAnimationFrame(render);
      const delta = Math.min(runtimeRef.current?.clock.getDelta() ?? 0, 0.1);
      const state = useEditorStore.getState();
      if (state.playing && state.keyframes.length) {
        const now = performance.now();
        const elapsed = (now - lastPlaybackRef.current) / 1000;
        lastPlaybackRef.current = now;
        let next = state.currentTime + elapsed;
        if (next > state.duration) {
          if (state.loop) next %= state.duration;
          else {
            next = state.duration;
            state.setPlaying(false);
          }
        }
        state.setCurrentTime(next);
        applyAnimationAt(next);
      } else {
        lastPlaybackRef.current = performance.now();
      }
      modelRef.current?.vrm?.update(delta);
      updateHandles();
      orbit.update();
      renderer.render(scene, camera);
    };
    render();

    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.currentTime !== previous.currentTime && !state.playing) applyAnimationAt(state.currentTime);
    });

    const onDragOver = (event: DragEvent): void => { event.preventDefault(); };
    const onDrop = (event: DragEvent): void => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file) void loadModel(file);
    };
    mount.addEventListener('dragover', onDragOver);
    mount.addEventListener('drop', onDrop);

    return () => {
      unsubscribe();
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrameRef.current);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('dragover', onDragOver);
      mount.removeEventListener('drop', onDrop);
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const model = modelRef.current;
    if (!runtime) return;
    if (!selectedBone || !model) {
      runtime.transform.detach();
      return;
    }
    const node = model.bones.get(selectedBone);
    if (!node) return;
    runtime.transform.attach(node);
    runtime.transform.setMode(gizmoMode === 'translate' && selectedBone !== 'hips' ? 'rotate' : gizmoMode);
    runtime.transform.setSpace('local');
    updateSelectedTransform();
  }, [selectedBone, gizmoMode]);

  useEffect(() => {
    if (runtimeRef.current) runtimeRef.current.grid.visible = showGrid;
  }, [showGrid]);

  useEffect(() => {
    if (runtimeRef.current) runtimeRef.current.helpers.visible = showHandles;
  }, [showHandles]);

  useEffect(() => {
    if (runtimeRef.current) runtimeRef.current.scene.background = new THREE.Color(background);
  }, [background]);

  useEffect(() => {
    const onLoad = (event: Event): void => {
      const file = (event as CustomEvent<File>).detail;
      if (file) void loadModel(file);
    };
    const onCapture = (): void => {
      if (!modelRef.current) {
        useEditorStore.getState().setStatus('Abra um modelo antes de adicionar keyframes.');
        return;
      }
      const state = useEditorStore.getState();
      const expressions = captureExpressions();
      state.upsertKeyframe({
        id: crypto.randomUUID(),
        time: state.currentTime,
        pose: capturePose(),
        ...(Object.keys(expressions).length ? { expressions } : {}),
        easing: 'smooth',
      });
      state.setStatus(`Keyframe salvo em ${state.currentTime.toFixed(2)}s.`);
    };
    const onResetPose = (): void => {
      const model = modelRef.current;
      if (!model) return;
      if (model.vrm) {
        model.vrm.humanoid.resetNormalizedPose();
        model.vrm.expressionManager?.resetValues();
        model.vrm.expressionManager?.update();
      } else {
        for (const node of model.bones.values()) node.quaternion.identity();
      }
      updateSelectedTransform();
      useEditorStore.getState().setDirtyPose(true);
    };
    const onPreset = (): void => {
      const model = modelRef.current;
      if (!model) return;
      if (model.vrm) model.vrm.humanoid.resetNormalizedPose();
      else for (const node of model.bones.values()) node.quaternion.identity();
      updateSelectedTransform();
      useEditorStore.getState().setDirtyPose(true);
      useEditorStore.getState().setStatus('T-Pose aplicada. Salve um keyframe para colocá-la na timeline.');
    };
    const onSetRotation = (event: Event): void => {
      const model = modelRef.current;
      const selected = useEditorStore.getState().selectedBone;
      const value = (event as CustomEvent<Vec3Tuple>).detail;
      const node = selected ? model?.bones.get(selected) : null;
      if (!node) return;
      node.rotation.set(value[0] * RAD, value[1] * RAD, value[2] * RAD, 'XYZ');
      updateSelectedTransform();
      useEditorStore.getState().setDirtyPose(true);
    };
    const onSetPosition = (event: Event): void => {
      const model = modelRef.current;
      const selected = useEditorStore.getState().selectedBone;
      const value = (event as CustomEvent<Vec3Tuple>).detail;
      const node = selected ? model?.bones.get(selected) : null;
      if (!node || selected !== 'hips') return;
      node.position.fromArray(value);
      updateSelectedTransform();
      useEditorStore.getState().setDirtyPose(true);
    };
    const onResetBone = (): void => {
      const model = modelRef.current;
      const selected = useEditorStore.getState().selectedBone;
      const node = selected ? model?.bones.get(selected) : null;
      if (!node) return;
      node.quaternion.identity();
      if (selected === 'hips') node.position.set(0, 0, 0);
      updateSelectedTransform();
      useEditorStore.getState().setDirtyPose(true);
    };
    const onCamera = (event: Event): void => frameCamera((event as CustomEvent<string>).detail);
    const onExport = (): void => {
      const state = useEditorStore.getState();
      if (!modelRef.current?.vrm) {
        state.setStatus('A exportação VRMA exige um modelo VRM com humanoide carregado.');
        return;
      }
      try {
        const buffer = exportVrma({
          name: state.projectName,
          keyframes: state.keyframes,
          duration: state.duration,
          interpolation: state.interpolation,
        });
        downloadBlob(new Blob([buffer], { type: 'model/gltf-binary' }), `${safeName(state.projectName)}.vrma`);
        state.setStatus('VRMA exportado com corpo e expressões faciais.');
      } catch (error) {
        state.setStatus(error instanceof Error ? error.message : 'Falha ao exportar VRMA.');
      }
    };
    const onScreenshot = (): void => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      runtime.renderer.render(runtime.scene, runtime.camera);
      runtime.renderer.domElement.toBlob((blob) => {
        if (blob) downloadBlob(blob, `${safeName(useEditorStore.getState().projectName)}-preview.png`);
      }, 'image/png');
    };

    window.addEventListener(editorEvent.loadModel, onLoad);
    window.addEventListener(editorEvent.captureKeyframe, onCapture);
    window.addEventListener(editorEvent.resetPose, onResetPose);
    window.addEventListener(editorEvent.applyPreset, onPreset);
    window.addEventListener(editorEvent.setBoneRotation, onSetRotation);
    window.addEventListener(editorEvent.setBonePosition, onSetPosition);
    window.addEventListener(editorEvent.resetBone, onResetBone);
    window.addEventListener(editorEvent.camera, onCamera);
    window.addEventListener(editorEvent.exportVrma, onExport);
    window.addEventListener(editorEvent.screenshot, onScreenshot);

    return () => {
      window.removeEventListener(editorEvent.loadModel, onLoad);
      window.removeEventListener(editorEvent.captureKeyframe, onCapture);
      window.removeEventListener(editorEvent.resetPose, onResetPose);
      window.removeEventListener(editorEvent.applyPreset, onPreset);
      window.removeEventListener(editorEvent.setBoneRotation, onSetRotation);
      window.removeEventListener(editorEvent.setBonePosition, onSetPosition);
      window.removeEventListener(editorEvent.resetBone, onResetBone);
      window.removeEventListener(editorEvent.camera, onCamera);
      window.removeEventListener(editorEvent.exportVrma, onExport);
      window.removeEventListener(editorEvent.screenshot, onScreenshot);
    };
  }, []);

  return (
    <div ref={mountRef} className="viewport-canvas">
      {!modelInfo && (
        <div className="drop-hint">
          <div className="drop-logo">V</div>
          <strong>Arraste seu modelo VRM aqui</strong>
          <span>ou use “Abrir modelo” na barra superior</span>
          <small>VRM recomendado · GLB e GLTF também podem ser visualizados</small>
        </div>
      )}
      <div className="viewport-help">LMB: selecionar · RMB: orbitar · roda: zoom · gizmo: editar</div>
    </div>
  );
}
