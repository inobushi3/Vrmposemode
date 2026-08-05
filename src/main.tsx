import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/mediapipeTimestampGuard';
import App from './App';
import TimelineDurationControls from './components/TimelineDurationControls';
import TimelineKeyframeDragLayer from './components/TimelineKeyframeDragLayer';
import ReferencePoseStudio from './components/ReferencePoseStudio';
import Rtmw3dStudio from './components/Rtmw3dStudio';
import Rtmw3dDepthControl from './components/Rtmw3dDepthControl';
import MotionLibraryStudio from './components/MotionLibraryStudio';
import MmdStudio from './components/MmdStudio';
import VrmMetaVersionProbe from './components/VrmMetaVersionProbe';
import PersonalPoseLibrary from './components/PersonalPoseLibrary';
import './styles.css';
import './timeline-custom.css';
import './timeline-keyframe-drag.css';
import './reference-pose.css';
import './reference-pose-preview-fit.css';
import './rtmw3d-studio.css';
import './rtmw3d-depth-control.css';
import './motion-library.css';
import './motion-library-formats.css';
import './mmd-studio.css';
import './mmd-canvas-fix.css';
import './mmd-motion-package.css';
import './personal-pose-library.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VrmMetaVersionProbe />
    <App />
    <TimelineDurationControls />
    <TimelineKeyframeDragLayer />
    <ReferencePoseStudio />
    <Rtmw3dStudio />
    <Rtmw3dDepthControl />
    <MotionLibraryStudio />
    <MmdStudio />
    <PersonalPoseLibrary />
  </StrictMode>,
);
