import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import TimelineDurationControls from './components/TimelineDurationControls';
import './styles.css';
import './timeline-custom.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <TimelineDurationControls />
  </StrictMode>,
);
