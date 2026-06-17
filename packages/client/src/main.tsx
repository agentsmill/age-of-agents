import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connectWorld } from './ws';
import { useMapping } from './mapping-store';

connectWorld();
// Pobierz zapisaną mapę narzędzie→budynek z lokalnego serwera (źródło prawdy).
void useMapping.getState().hydrate();

createRoot(document.getElementById('root')!).render(<App />);
