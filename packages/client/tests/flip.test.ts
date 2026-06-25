import { describe, it, expect } from 'vitest';
import { Container, Graphics, Text, type Container as PixiContainer } from 'pixi.js';
import { worldLayerTransform, worldToViewport, flipAxis, flipTextNodes } from '../src/game/flip';
import { Unit } from '../src/game/unit';
import { topdown } from '../src/game/projection';

// Granice świata przykładowej planszy (jak liczone w GameView.init).
const minX = -100;
const maxX = 500;
const minY = -40;
const worldWidth = maxX - minX; // 600

describe('worldLayerTransform', () => {
  it('bez odbicia: kotwiczy lewy brzeg (-minX), skala 1', () => {
    expect(worldLayerTransform(minX, maxX, minY, false)).toEqual({ x: 100, y: 40, scaleX: 1, scaleY: 1 });
  });

  it('z odbiciem: kotwiczy prawy brzeg (maxX), skala x=-1', () => {
    expect(worldLayerTransform(minX, maxX, minY, true)).toEqual({ x: 500, y: 40, scaleX: -1, scaleY: 1 });
  });
});

describe('worldToViewport', () => {
  const sx = 150;
  const sy = 80;
  const unflipped = worldToViewport(worldLayerTransform(minX, maxX, minY, false), sx, sy);
  const flipped = worldToViewport(worldLayerTransform(minX, maxX, minY, true), sx, sy);

  it('bez odbicia przesuwa punkt o -minX', () => {
    expect(unflipped).toEqual({ x: 250, y: 120 });
  });

  it('z odbiciem lustrzanie odbija X (maxX - sx)', () => {
    expect(flipped.x).toBe(350);
  });

  it('odbicie nie rusza osi Y', () => {
    expect(flipped.y).toBe(unflipped.y);
  });

  it('punkt i jego odbicie są symetryczne — suma X = szerokość świata', () => {
    // To jest niezmiennik flipa: ścieżka flipped vs unflipped to lustro względem
    // pionowej osi planszy. Suma X obu ścieżek = stała = worldWidth.
    expect(flipped.x + unflipped.x).toBe(worldWidth);
  });
});

describe('flipAxis', () => {
  it('bez odbicia zwraca wartość bez zmian', () => {
    expect(flipAxis(42, 180, false)).toBe(42);
  });

  it('z odbiciem zwraca extent - value', () => {
    expect(flipAxis(42, 180, true)).toBe(138);
  });

  it('podwójne odbicie to tożsamość (round-trip render→klik)', () => {
    expect(flipAxis(flipAxis(42, 180, true), 180, true)).toBe(42);
  });
});

describe('flipTextNodes', () => {
  it('ustawia scale.x=-1 na węzłach Text (także zagnieżdżonych), nie rusza reszty', () => {
    const root = new Container();
    const topText = new Text({ text: 'góra' });
    const graphic = new Graphics(); // np. krążek odznaki — nie Text, ma zostać nietknięty
    const sub = new Container();
    const nestedText = new Text({ text: 'litera' }); // np. litera w odznace agenta
    sub.addChild(nestedText);
    root.addChild(topText, graphic, sub);

    flipTextNodes(root);

    expect(topText.scale.x).toBe(-1);
    expect(nestedText.scale.x).toBe(-1);
    expect(graphic.scale.x).toBe(1);
  });
});

describe('Unit screen-facing overlays under world flip', () => {
  it('counter-flips the context bar so fill direction stays left-to-right on screen', () => {
    const unit = new Unit('u1', 0, false, 'Hero', { gx: 1, gy: 1 }, topdown(16));
    const contextBar = (unit as unknown as { contextBar: PixiContainer }).contextBar;

    expect(contextBar.scale.x).toBe(1);
    unit.setScreenFlipped(true);
    expect(contextBar.scale.x).toBe(-1);
    unit.setScreenFlipped(false);
    expect(contextBar.scale.x).toBe(1);
  });
});
