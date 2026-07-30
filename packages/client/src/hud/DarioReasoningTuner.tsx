import { useState } from 'react';
import { getGameView } from '../game/view';

const MODES = [
  { label: 'low', loops: 1 },
  { label: 'medium', loops: 2 },
  { label: 'high', loops: 3 },
  { label: 'xhigh', loops: 4 },
] as const;

export function DarioReasoningTuner() {
  const [modeIndex, setModeIndex] = useState(0);
  const mode = MODES[modeIndex];

  return (
    <button
      className="ghost dario-reasoning-toggle"
      onClick={() => {
        const nextIndex = (modeIndex + 1) % MODES.length;
        setModeIndex(nextIndex);
        getGameView()?.setRulerReasoning(MODES[nextIndex].loops);
      }}
      title="King Dario Reasoning Effort"
      aria-label={`King Dario Reasoning Effort: ${mode.label}`}
    >
      {mode.label}
    </button>
  );
}
