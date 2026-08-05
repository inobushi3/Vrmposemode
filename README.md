# VRM Pose Mode

Desktop editor for loading VRM avatars, importing humanoid and facial motion, editing the result as keyframes and exporting VRM Animation (`.vrma`).

## Current features

- Load `.vrm`, `.glb` and `.gltf` avatar/model files
- Edit normalized VRM humanoid bones with visual handles and transform gizmos
- Pose presets, timeline, playback, loop, FPS, duration and draggable keyframes
- Undo and redo for timeline changes
- Persistent local motion library
- Direct motion conversion from VRMA, BVH, FBX and animated GLB/glTF
- Penumbra/FFXIV conversion on Windows:
  - open `.pmp` mod packages and standalone `.pap` animations
  - list every animation stored inside each PAP
  - identify race/skeleton codes such as `c0101`, `c0901` and `c1101`
  - combine the PAP with the matching `.sklb` skeleton
  - download the official XAT runtime once and reuse it offline
  - convert Havok animation to a temporary FBX and retarget it to VRM keyframes
- MMD Studio:
  - open PMX/PMD models from files, folders or complete ZIP bundles
  - resolve local textures, sphere maps and toon resources
  - open VMD/VPD directly or from ZIP motion packs
  - choose among multiple VMD/VPD files found inside a package
  - execute body VMD on its PMX/PMD source with MMD IK and grants
  - convert facial/lip-only VMD directly without requiring a PMX/PMD model
  - read common MMD Japanese morph names and VRMLiveViewer `VMDMorph` mapping JSON files
  - convert body and expression channels into ordinary editor keyframes
- Clip selection for files containing multiple animations
- Rest-pose delta retargeting instead of copying source local axes directly
- Optional root motion, displacement scaling and 15/30/60 FPS sampling
- Experimental image, GIF and video pose capture
- Local RTMW3D-x inference through ONNX Runtime and DirectML on Windows
- Binary VRMA 1.0 export with humanoid and facial expression tracks

## Run

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

## PMP and PAP workflow

A Penumbra `.pmp` file is a ZIP mod package. A dance package commonly contains one or more Final Fantasy XIV `.pap` files. PAP stores Havok animation data, but not the complete skeleton hierarchy and rest pose needed to interpret its transform tracks. The matching `.sklb` file is therefore required.

1. Open the target VRM.
2. Open **Movements** and import the `.pmp` or `.pap` file.
3. Select the desired internal PAP animation.
4. The interface shows the expected skeleton, for example `skl_c0101b0001.sklb`.
5. Select that `.sklb` file.
6. Click **Prepare XAT converter** on the first use. The official XAT release is downloaded to the application data directory and reused offline.
7. Click **Convert PAP to timeline**.
8. The app extracts PAP and SKLB Havok containers, asks XAT to create a temporary FBX, retargets the FBX to the normalized VRM humanoid and inserts normal editable keyframes.
9. Review the motion and export VRMA.

The XAT bridge is Windows-only and requires the Microsoft Visual C++ Redistributable 2012 x86 used by XAT. Game skeleton files are not bundled with this repository; use a matching SKLB extracted from your own Final Fantasy XIV installation with an established XIV tool.

## MMD workflow

### Body motion

1. Open the target VRM.
2. Open **MMD**.
3. Select the PMX/PMD source model, its folder or a complete model ZIP.
4. Select a VMD/VPD file or a motion ZIP.
5. Choose the internal motion when the ZIP contains multiple files.
6. Convert to the timeline.
7. Correct keyframes and export VRMA.

Body VMD needs a PMX/PMD source because the source model defines the bone names, hierarchy, IK and grants. The app evaluates that system before retargeting to the normalized VRM humanoid.

### Facial and lip motion

A VMD containing zero bone frames and facial morph frames can be converted without an MMD model:

1. Open the target VRM.
2. Open **MMD**.
3. Select the facial/lip VMD or its ZIP package.
4. Convert to the timeline.
5. Preview expressions and export VRMA.

The importer maps common MMD morphs such as blinking, winks, emotions and Japanese vowel mouth shapes to expressions available in the target VRM. Bundled VRMLiveViewer mapping JSON files are used when present. Morphs without an equivalent target expression are reported and ignored rather than assigned incorrectly.

The timeline stores body pose and expression weights together. Exported VRMA files use the official `VRMC_vrm_animation.expressions` preset/custom mappings.

## Standard motion retargeting

For BVH, FBX and animated glTF/GLB sources, the importer:

1. recognizes source bones by aliases and hierarchy names;
2. records the source skeleton rest pose;
3. evaluates the original animation clip;
4. calculates world-space rotation deltas from the source rest pose;
5. converts those deltas to the normalized VRM humanoid hierarchy;
6. normalizes root displacement by source body height;
7. samples the motion into ordinary editor keyframes.

VRMA files use the official `@pixiv/three-vrm-animation` loader, including VRM0 axis conversion and facial expression tracks.

## Limitations

- A valid humanoid VRM must be open before applying and exporting motion.
- PAP conversion requires the matching SKLB; using a skeleton from another race or family can corrupt the result.
- PMX/PMD models are source/preview models; VRMA contains animation and does not convert the MMD mesh into a VRM avatar.
- Facial conversion depends on expressions that actually exist in the target VRM.
- MMD rigid-body physics, cloth and hair simulation are not exported as humanoid VRMA tracks.
- A GLB/glTF file must contain skeletal animation clips; geometry-only files cannot become VRMA.
- Prefer GLB over glTF when external `.bin` or texture files are referenced.
- Image/video reconstruction remains experimental because monocular depth and retargeting are ambiguous.

## License

MIT
