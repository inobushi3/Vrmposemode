# VRM Pose Mode

Desktop editor for loading VRM avatars, importing humanoid motion, editing the result as keyframes and exporting VRM Animation (`.vrma`).

## Current features

- Load `.vrm`, `.glb` and `.gltf` avatar/model files
- Edit normalized VRM humanoid bones with visual handles and transform gizmos
- Pose presets, timeline, playback, loop, FPS, duration and draggable keyframes
- Undo and redo for timeline changes
- Persistent local motion library
- Direct motion conversion from:
  - VRM Animation (`.vrma`)
  - BioVision Hierarchy (`.bvh`)
  - Filmbox animation (`.fbx`)
  - animated GLB (`.glb`)
  - embedded animated glTF (`.gltf`)
- Clip selection for files containing multiple animations
- Automatic humanoid bone mapping for common VRM, Mixamo, BVH, Rigify and FFXIV-style bone names
- Rest-pose delta retargeting instead of copying source local axes directly
- Optional root motion, displacement scaling and 15/30/60 FPS sampling
- Penumbra `.pmp` package inspection and embedded standard-motion extraction
- Explicit Final Fantasy XIV `.pap` detection without unsafe skeleton guessing
- Experimental image, GIF and video pose capture
- Local RTMW3D-x inference through ONNX Runtime and DirectML on Windows
- Binary VRMA 1.0 export using `VRMC_vrm_animation`
- No installer required for development use

## Run

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

## Recommended workflow

1. Open the target `.vrm` avatar.
2. Open **Motions**.
3. Import a VRMA, BVH, FBX, GLB or glTF animation.
4. Select the animation clip when the source contains multiple clips.
5. Use 30 FPS first, enable root motion when displacement is required and convert it to the timeline.
6. Correct any bone or keyframe manually.
7. Export the edited result with **Export VRMA**.

The original motion file stays in IndexedDB on the local computer. No motion or avatar file is uploaded to an external service.

## Retargeting

For BVH, FBX and animated glTF/GLB sources, the importer:

1. recognizes source bones by aliases and hierarchy names;
2. records the source skeleton rest pose;
3. evaluates the original animation clip;
4. calculates world-space rotation deltas from the source rest pose;
5. converts those deltas to the normalized VRM humanoid hierarchy;
6. normalizes root displacement by source body height;
7. samples the motion into ordinary editor keyframes.

This is more reliable than copying the source bone Euler angles because FBX, BVH, Mixamo and VRM rigs can use different local axes.

VRMA files use the official `@pixiv/three-vrm-animation` loader. Absolute hips translation is converted to a displacement relative to the animation T-pose before it enters the editor.

## PMP and PAP

Penumbra `.pmp` files are ZIP packages. The app reads package metadata, lists embedded animations and directly imports supported VRMA/BVH/FBX/GLB/glTF files when present.

Final Fantasy XIV `.pap` files contain proprietary Havok animation data and do not include enough skeleton information for safe standalone retargeting. Direct PAP conversion requires the matching `.sklb` skeleton plus a compatible PAP/Havok decoder such as an external XIV animation toolkit. The app reports this requirement instead of producing corrupted VRMA output.

## Limitations

- A valid humanoid VRM must be open before applying and exporting motion.
- A GLB/glTF file must contain skeletal animation clips; geometry-only files cannot become VRMA.
- Prefer GLB over glTF when the glTF references external `.bin` or texture files.
- Bone mapping can require manual correction when a source uses unusual or unnamed joints.
- Facial expressions and look-at tracks from imported motion are not yet part of the body timeline.
- Image/video reconstruction remains experimental because monocular depth and retargeting are ambiguous.

## Development order

1. Multi-format motion library and VRMA conversion — implemented
2. IK handles for hands, feet, head and hips
3. Motion block sequencer and transition blending
4. Optional external PAP/SKLB conversion bridge
5. Additional proprietary formats only when a reliable decoder and skeleton metadata are available

## Keyboard shortcuts

- `Space`: play/pause
- `R`: rotation gizmo
- `G`: move hips
- `K`: add/update keyframe
- `Ctrl+Z`: undo
- `Ctrl+Y` or `Ctrl+Shift+Z`: redo

## Main files

- `src/components/Viewport.tsx`: Three.js scene, VRM loading and manual editing
- `src/components/MotionLibraryStudio.tsx`: local motion library and conversion UI
- `src/lib/motionImporter.ts`: BVH/FBX/GLB/glTF retargeting and PMP/PAP inspection
- `src/lib/vrmaImporter.ts`: official VRMA loading and keyframe conversion
- `src/lib/motionLibrary.ts`: IndexedDB persistence
- `src/lib/vrmaExporter.ts`: VRMA 1.0 exporter
- `src/store.ts`: editor state and history

## License

MIT
