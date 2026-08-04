import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import TimelineDurationControls from './components/TimelineDurationControls';
import TimelineKeyframeDragLayer from './components/TimelineKeyframeDragLayer';
import './styles.css';
import './timeline-custom.css';
import './timeline-keyframe-drag.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <TimelineDurationControls />
    <TimelineKeyframeDragLayer />
  </StrictMode>,
);
