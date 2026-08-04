import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/mediapipeTimestampGuard';
import App from './App';
import TimelineDurationControls from './components/TimelineDurationControls';
import TimelineKeyframeDragLayer from './components/TimelineKeyframeDragLayer';
import ReferencePoseStudio from './components/ReferencePoseStudio';
import './styles.css';
import './timeline-custom.css';
import './timeline-keyframe-drag.css';
import './reference-pose.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <TimelineDurationControls />
    <TimelineKeyframeDragLayer />
    <ReferencePoseStudio />
  </StrictMode>,
);
