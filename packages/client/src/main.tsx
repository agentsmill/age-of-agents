import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connectWorld } from './ws';
import { useMapping } from './mapping-store';
import { useModels } from './model-store';

connectWorld();
// Fetch saved configs from the local server (source of truth).
void useMapping.getState().hydrate();
void useModels.getState().hydrate();

createRoot(document.getElementById('root')!).render(<App />);
