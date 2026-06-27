import { useEffect, useState } from 'react';
import { GameCanvas } from './GameCanvas';
import { MissionLog } from './hud/MissionLog';
import { NotificationFeed } from './hud/NotificationFeed';
import { Minimap } from './hud/Minimap';
import { Portraits } from './hud/Portraits';
import { ResourceBar } from './hud/ResourceBar';
import { SidePanel } from './hud/SidePanel';
import { QuestionModal } from './hud/QuestionModal';
import { BuildingPanel } from './hud/BuildingPanel';
import { ThemeSwitch } from './hud/ThemeSwitch';
import { ZoomControls } from './hud/ZoomControls';
import { ArchitectHall } from './hud/ArchitectHall';
import { CostPanel } from './hud/CostPanel';
import { requestPermission } from './desktop-notify';
import './hud/hud.css';

export function App() {
  useEffect(() => { requestPermission(); }, []);
  const [showCost, setShowCost] = useState(false);
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <GameCanvas />
      <ThemeSwitch />
      <ResourceBar onCostClick={() => setShowCost((v) => !v)} />
      <MissionLog />
      <NotificationFeed />
      <SidePanel />
      {showCost && <CostPanel onClose={() => setShowCost(false)} />}
      <QuestionModal />
      <BuildingPanel />
      <ArchitectHall />
      <Portraits />
      <ZoomControls />
      <Minimap />
    </div>
  );
}
