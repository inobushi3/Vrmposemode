import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/mediapipeTimestampGuard';
import App from './App';
import TimelineDurationControls from './components/TimelineDurationControls';
import TimelineKeyframeDragLayer from './components/TimelineKeyframeDragLayer';
import ReferencePoseStudio from './components/ReferencePoseStudio';
import Rtmw3dStudio from './components/Rtmw3dStudio';
import Rtmw3dDepthControl from './components/Rtmw3dDepthControl';
import './styles.css';
import './timeline-custom.css';
import './timeline-keyframe-drag.css';
import './reference-pose.css';
import './reference-pose-preview-fit.css';
import './rtmw3d-studio.css';
import './rtmw3d-depth-control.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <TimelineDurationControls />
    <TimelineKeyframeDragLayer />
    <ReferencePoseStudio />
    <Rtmw3dStudio />
    <Rtmw3dDepthControl />
  </StrictMode>,
);
