import { AnimatedSprite, Container, Sprite, Text } from 'pixi.js';
import type { Projection } from './projection';
import type { ThemeDef } from '../theme/types';
import { labelStyle } from './placeholders';
import { getCharacterTexture, getKingAnimSheet } from './character-sprites';

const DARIO_OFFSET = { dx: 61, dy: -126 };
const SCALE = 0.7;
const PACE_AMP = 24;
const GLIDE_SPEED = 0.3;
const FRAME_SPEED = 0.12;
const BREATH_PERIOD = 14;
const BREATH_AMP = 0.03;
const MEDIT_HOLD_SPEED = 0.00476;
const DEFAULT_REASONING_LOOPS = 1;

const DARIO_CLIPS = [
  'groovewalk',
  'surveyup',
  'surveyhold',
  'surveydown',
  'thinkup',
  'thinkhold',
  'thinkdown',
  'fistslam',
  'fisthold',
  'fistflourish',
  'meditsit',
  'medithold',
  'meditrise',
  'foldin',
  'foldhold',
  'foldout',
] as const;

type DarioClip = (typeof DARIO_CLIPS)[number];
type StoryBeat = { clip: DarioClip; moving: boolean; until: 'clip' | 'arrive'; faceSE?: boolean; to?: number };

const stand = (clip: DarioClip): StoryBeat => ({ clip, moving: false, until: 'clip', faceSE: true });
const walkTo = (to: number): StoryBeat => ({ clip: 'groovewalk', moving: true, until: 'arrive', to });
const isHoldClip = (clip: DarioClip) => clip.includes('hold');

const STORY: StoryBeat[] = [
  { clip: 'medithold', moving: false, until: 'clip', faceSE: true },
  { clip: 'meditrise', moving: false, until: 'clip', faceSE: true },
  walkTo(1),
  stand('surveyup'),
  stand('surveyhold'),
  stand('surveydown'),
  stand('thinkup'),
  stand('thinkhold'),
  stand('thinkdown'),
  stand('fistslam'),
  stand('fisthold'),
  stand('fistflourish'),
  walkTo(-1),
  stand('surveyup'),
  stand('surveyhold'),
  stand('surveydown'),
  stand('thinkup'),
  stand('thinkhold'),
  stand('thinkdown'),
  stand('foldin'),
  stand('foldhold'),
  stand('foldout'),
  walkTo(0),
  { clip: 'meditsit', moving: false, until: 'clip', faceSE: true },
];

export interface RulerHandle {
  container: Container;
  setReasoning(loops: number): void;
  update(dt: number): void;
}

export function buildRuler(theme: ThemeDef, projection: Projection, label: string): RulerHandle | undefined {
  if (theme.id !== 'fantasy') return undefined;
  const citadel = theme.buildings.find((building) => building.id === 'citadel');
  if (!citadel) return undefined;

  const cx = citadel.gx + citadel.w / 2;
  const cy = citadel.gy + citadel.h;
  const foot = projection.toScreen(cx, cy);
  const home = { x: foot.x + DARIO_OFFSET.dx, y: foot.y + DARIO_OFFSET.dy };

  const container = new Container();
  const bodies: Array<Sprite | AnimatedSprite> = [];
  let update = (_dt: number) => {};
  let setReasoning = (_loops: number) => {};

  const tex = getCharacterTexture('dario-king');
  const anim = getKingAnimSheet();
  if (tex) {
    const idle = new Sprite(tex);
    idle.anchor.set(0.5, 1);
    idle.scale.set(SCALE);
    idle.visible = true;
    container.addChild(idle);
    bodies.push(idle);

    const clips: Partial<Record<DarioClip, AnimatedSprite>> = {};
    for (const name of DARIO_CLIPS) {
      const frames = anim?.animations[name];
      if (!frames) continue;
      const sprite = new AnimatedSprite(frames);
      sprite.anchor.set(0.5, 1);
      sprite.scale.set(SCALE);
      sprite.animationSpeed = name === 'medithold' ? MEDIT_HOLD_SPEED : FRAME_SPEED;
      sprite.loop = true;
      sprite.visible = false;
      container.addChild(sprite);
      bodies.push(sprite);
      clips[name] = sprite;
    }

    const available = DARIO_CLIPS.filter((clip) => clips[clip]);
    if (available.length) {
      let storyStep = 0;
      let reasoningLoops = DEFAULT_REASONING_LOOPS;
      let paceU = 0;
      let targetU = 1;
      let facing = 1;
      let breathT = 0;
      let breathing = false;

      const stopAllBut = (clip: DarioClip) => {
        idle.visible = false;
        for (const candidate of available) {
          if (candidate === clip) continue;
          const sprite = clips[candidate]!;
          sprite.stop();
          sprite.visible = false;
          sprite.onComplete = undefined;
          sprite.onLoop = undefined;
        }
      };

      const advanceStory = () => {
        storyStep = (storyStep + 1) % STORY.length;
        playStoryStep();
      };

      const playStoryStep = () => {
        const beat = STORY[storyStep];
        const sprite = clips[beat.clip];
        if (!sprite) {
          advanceStory();
          return;
        }
        if (beat.moving && beat.to !== undefined) targetU = beat.to;
        if (beat.faceSE) facing = 1;
        stopAllBut(beat.clip);
        sprite.visible = true;
        if (beat.until === 'arrive') {
          sprite.loop = true;
          sprite.onComplete = undefined;
          sprite.onLoop = undefined;
        } else if (isHoldClip(beat.clip)) {
          let loops = 0;
          sprite.loop = true;
          sprite.onComplete = undefined;
          sprite.onLoop = () => {
            if (++loops >= reasoningLoops) {
              sprite.onLoop = undefined;
              advanceStory();
            }
          };
        } else {
          sprite.loop = false;
          sprite.onLoop = undefined;
          sprite.onComplete = () => {
            sprite.onComplete = undefined;
            advanceStory();
          };
        }
        sprite.gotoAndPlay(0);
      };

      playStoryStep();

      setReasoning = (loops) => {
        reasoningLoops = Math.max(1, Math.min(3, Math.round(loops)));
      };

      update = (dt) => {
        const beat = STORY[storyStep];
        if (beat.moving) {
          const step = GLIDE_SPEED * dt;
          if (Math.abs(targetU - paceU) <= step) {
            paceU = targetU;
            advanceStory();
          } else {
            paceU += Math.sign(targetU - paceU) * step;
            facing = targetU > paceU ? 1 : -1;
          }
        }

        const paceOffX = paceU * PACE_AMP;
        const paceOffY = -paceU * PACE_AMP * 0.5;
        const activeClip = STORY[storyStep].clip;
        const activeSprite = clips[activeClip];

        if (activeClip === 'medithold' && activeSprite) {
          breathT += dt;
          breathing = true;
          const swell = (1 - Math.cos((2 * Math.PI * breathT) / BREATH_PERIOD)) / 2;
          activeSprite.scale.y = SCALE * (1 + BREATH_AMP * swell);
        } else if (breathing) {
          breathing = false;
          breathT = 0;
          const meditateHold = clips.medithold;
          if (meditateHold) meditateHold.scale.y = SCALE;
        }

        container.position.set(home.x + paceOffX, home.y + paceOffY);
        for (const body of bodies) body.scale.x = SCALE * facing;
      };
    }
  }

  const name = new Text({ text: label, style: labelStyle });
  name.anchor.set(0.5, 0);
  name.position.set(0, 8);
  container.addChild(name);

  container.position.set(home.x, home.y);
  container.zIndex = projection.depth(cx, cy) + 1;

  return {
    container,
    setReasoning: (loops) => setReasoning(loops),
    update: (dt) => update(dt),
  };
}
