import { useWorld } from '../store';

/** Dziennik misji: aktywne na górze, potem ostatnie ukończone. */
export function MissionLog() {
  const missions = useWorld((s) => s.missions);
  const heroes = useWorld((s) => s.heroes);
  const selected = useWorld((s) => s.selectedSessionId);
  if (selected) return null; // panel boczny przejmuje prawą stronę

  const all = Object.values(missions).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const active = all.filter((m) => m.status === 'active').slice(0, 5);
  const done = all.filter((m) => m.status !== 'active').slice(0, 5);
  if (active.length + done.length === 0) return null;

  return (
    <div className="hud-panel missions">
      <h3>Misje</h3>
      {[...active, ...done].map((mission) => (
        <div key={mission.id} className="mission">
          <div>
            {mission.status === 'active' ? '⚔️' : mission.status === 'completed' ? '✅' : '💀'}{' '}
            {clip(mission.prompt, 90)}
          </div>
          <div className="meta">{heroes[mission.sessionId]?.title ? clip(heroes[mission.sessionId].title, 40) : mission.sessionId.slice(0, 8)}</div>
        </div>
      ))}
    </div>
  );
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
