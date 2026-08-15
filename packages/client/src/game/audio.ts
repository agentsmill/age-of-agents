/**
 * RealmAudio — generative ambient soundscape for the Agent Citadel realm.
 *
 * Pure Web Audio API synthesis: no asset files, no external dependencies.
 * Designed as calm second-monitor ambience — low gains, soft timbres.
 *
 * Usage pattern:
 *   const audio = new RealmAudio();
 *   // On first user gesture:
 *   await audio.resume();
 *   audio.setEnabled(true);
 *   // Per-frame (in building-FX update loop):
 *   audio.setBuildingIntensity(id, smoothedIntensity);
 *   // On state transitions:
 *   audio.cue('mission-complete');
 *   audio.cue('awaiting-input');
 *   // On teardown:
 *   audio.destroy();
 */

import type { BuildingId } from '../theme/types';

// ─── Voice profile ────────────────────────────────────────────────────────────

/**
 * Timbral profile for each building's oscillator voice.
 * freq: fundamental Hz; detune: fine-tuning cents; wave: oscillator type;
 * filterFreq: lowpass cutoff Hz; maxGain: peak amplitude (keep gentle!).
 */
interface VoiceProfile {
  freq: number;
  detune: number;
  wave: OscillatorType;
  filterFreq: number;
  maxGain: number;
}

/**
 * Per-building voice profiles — characters mirror the FX palette in building-fx.ts:
 *   citadel  = warm sine hum (command centre)
 *   tower    = bright sine (lookout/web)
 *   forge    = sawtooth with warm filter (fire/metal)
 *   library  = pure sine, cool (archival/read)
 *   mine     = low sine drone (excavation/bash)
 *   barracks = square wave, mid (troops/tasks)
 *   market   = triangle, buoyant (commerce/git)
 *   guild    = sine with vibrato detune (MCP/magic)
 *   arena    = punchy triangle (combat/test)
 *   tavern   = warm sine, low (smoke/warmth)
 *   garden   = high pure sine (nature/breath)
 *   bar      = triangle, rosy mid (social)
 *   shrine   = soft sine, very high (sacred)
 *   holodeck = bright sawtooth, filtered (electric)
 *   mess     = low warm triangle (steam/fuel)
 *   hydroponics = gentle sine, mid-high (bubbles)
 *   lounge   = soft square, filtered low (ambient pad)
 *   medbay   = sine, clinical mid (pulse/monitor)
 */
const VOICE_PROFILES: Record<BuildingId, VoiceProfile> = {
  citadel:     { freq: 110.0, detune:   0, wave: 'sine',     filterFreq: 800,  maxGain: 0.055 },
  tower:       { freq: 329.6, detune:   5, wave: 'sine',     filterFreq: 2000, maxGain: 0.042 },
  forge:       { freq: 146.8, detune: -10, wave: 'sawtooth', filterFreq: 600,  maxGain: 0.032 },
  library:     { freq: 220.0, detune:   0, wave: 'sine',     filterFreq: 1200, maxGain: 0.045 },
  mine:        { freq:  82.4, detune:   0, wave: 'sine',     filterFreq: 500,  maxGain: 0.060 },
  barracks:    { freq: 196.0, detune:   8, wave: 'square',   filterFreq: 700,  maxGain: 0.028 },
  market:      { freq: 261.6, detune:   3, wave: 'triangle', filterFreq: 1500, maxGain: 0.040 },
  guild:       { freq: 174.6, detune:  15, wave: 'sine',     filterFreq: 1400, maxGain: 0.038 },
  arena:       { freq: 164.8, detune:  -5, wave: 'triangle', filterFreq: 900,  maxGain: 0.035 },
  tavern:      { freq: 123.5, detune:   0, wave: 'sine',     filterFreq: 600,  maxGain: 0.050 },
  garden:      { freq: 523.3, detune:   2, wave: 'sine',     filterFreq: 3000, maxGain: 0.038 },
  bar:         { freq: 246.9, detune:   6, wave: 'triangle', filterFreq: 1100, maxGain: 0.036 },
  shrine:      { freq: 659.3, detune:  -3, wave: 'sine',     filterFreq: 4000, maxGain: 0.030 },
  holodeck:    { freq: 392.0, detune:  12, wave: 'sawtooth', filterFreq: 1800, maxGain: 0.028 },
  mess:        { freq: 110.0, detune:  -8, wave: 'triangle', filterFreq: 500,  maxGain: 0.048 },
  hydroponics: { freq: 311.1, detune:   4, wave: 'sine',     filterFreq: 2200, maxGain: 0.040 },
  lounge:      { freq: 185.0, detune:  -6, wave: 'square',   filterFreq: 400,  maxGain: 0.025 },
  medbay:      { freq: 277.2, detune:   0, wave: 'sine',     filterFreq: 1600, maxGain: 0.042 },
};

// ─── Internal voice node graph ────────────────────────────────────────────────

interface BuildingVoice {
  osc: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

// ─── RealmAudio ───────────────────────────────────────────────────────────────

export class RealmAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private voices = new Map<BuildingId, BuildingVoice>();
  private enabled = false;
  private masterVolume = 0.6;
  private destroyed = false;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  constructor() {
    // AudioContext is NOT created here — autoplay policy requires a user gesture first.
  }

  /**
   * Lazily create (or resume) the AudioContext. Safe to call multiple times.
   * Must be called from within a user-gesture handler (click, keydown, etc.).
   */
  async resume(): Promise<void> {
    if (this.destroyed) return;

    if (!this.ctx) {
      // Feature-detect: older browsers may not have AudioContext.
      const AC =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return; // No Web Audio support — degrade gracefully.

      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.enabled ? this.masterVolume : 0;
      this.masterGain.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /** Master on/off. When disabled, silence everything (gain → 0) cheaply. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.masterGain && this.ctx) {
      const t = this.ctx.currentTime;
      this.masterGain.gain.setTargetAtTime(on ? this.masterVolume : 0, t, 0.1);
    }
  }

  /** 0..1 overall volume multiplier. Applied to the master gain node. */
  setMasterVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.enabled && this.masterGain && this.ctx) {
      const t = this.ctx.currentTime;
      this.masterGain.gain.setTargetAtTime(this.masterVolume, t, 0.1);
    }
  }

  /**
   * Call once per render frame for each active building.
   * intensity: 0..1 (typically a smoothed worker-activity value from view.ts).
   * Voices are created lazily on the first nonzero call; gain ramps are
   * click-free via setTargetAtTime (20 ms time constant).
   */
  setBuildingIntensity(id: BuildingId, intensity: number): void {
    if (this.destroyed || !this.ctx || !this.masterGain) return;

    const clamped = Math.max(0, Math.min(1, intensity));
    const voice = this._getOrCreateVoice(id);
    if (!voice) return;

    const profile = VOICE_PROFILES[id];
    const targetGain = clamped * profile.maxGain;
    const t = this.ctx.currentTime;
    // Time constant 0.08 s → smooth ~240 ms fade; no audible clicks.
    voice.gain.gain.setTargetAtTime(targetGain, t, 0.08);
  }

  /**
   * One-shot cue sounds (no sustained state — fire and forget).
   *   'mission-complete' : gentle rising arpeggio (C maj pentatonic, 4 notes).
   *   'awaiting-input'   : soft two-note descending chime (unmissable but calm).
   */
  cue(kind: 'mission-complete' | 'awaiting-input'): void {
    if (this.destroyed || !this.ctx || !this.enabled) return;

    if (kind === 'mission-complete') {
      this._playArpeggio([523.25, 659.25, 783.99, 1046.5], 0.12, 0.13, 0.55);
    } else {
      this._playChime([440, 330], 0.14, 0.22, 0.7);
    }
  }

  /** Disconnect all nodes and close the AudioContext. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const voice of this.voices.values()) {
      try {
        voice.osc.stop();
        voice.osc.disconnect();
        voice.filter.disconnect();
        voice.gain.disconnect();
      } catch {
        // Already stopped/disconnected — ignore.
      }
    }
    this.voices.clear();

    if (this.masterGain) {
      try { this.masterGain.disconnect(); } catch { /* ignore */ }
      this.masterGain = null;
    }

    if (this.ctx) {
      this.ctx.close().catch(() => { /* ignore close errors */ });
      this.ctx = null;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Return existing voice or lazily create one for the given building. */
  private _getOrCreateVoice(id: BuildingId): BuildingVoice | null {
    if (!this.ctx || !this.masterGain) return null;

    const existing = this.voices.get(id);
    if (existing) return existing;

    const profile = VOICE_PROFILES[id];
    const ctx = this.ctx;

    const osc = ctx.createOscillator();
    osc.type = profile.wave;
    osc.frequency.value = profile.freq;
    osc.detune.value = profile.detune;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = profile.filterFreq;
    filter.Q.value = 0.8;

    const gain = ctx.createGain();
    gain.gain.value = 0; // Start silent; ramp up on first setBuildingIntensity call.

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start();

    const voice: BuildingVoice = { osc, filter, gain };
    this.voices.set(id, voice);
    return voice;
  }

  /**
   * Play a rising arpeggio of sine tones.
   * freqs: Hz array (played sequentially); peakGain: per-note peak; step: seconds between notes; duration: per-note fade.
   */
  private _playArpeggio(
    freqs: number[],
    peakGain: number,
    step: number,
    duration: number,
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const master = this.masterGain;
    const now = ctx.currentTime;

    freqs.forEach((freq, i) => {
      const noteStart = now + i * step;
      const noteEnd = noteStart + duration;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, noteStart);
      env.gain.linearRampToValueAtTime(peakGain, noteStart + 0.02);
      env.gain.setTargetAtTime(0, noteEnd - 0.1, 0.06);

      osc.connect(env);
      env.connect(master);
      osc.start(noteStart);
      osc.stop(noteEnd + 0.2);

      // Clean up after the note finishes (avoid node leaks).
      osc.addEventListener('ended', () => {
        try { osc.disconnect(); env.disconnect(); } catch { /* ignore */ }
      });
    });
  }

  /**
   * Play a short two-note chime.
   * freqs: [first, second] Hz; peakGain: peak amplitude; step: gap seconds; duration: per-note sustain.
   */
  private _playChime(
    freqs: [number, number],
    peakGain: number,
    step: number,
    duration: number,
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const master = this.masterGain;
    const now = ctx.currentTime;

    freqs.forEach((freq, i) => {
      const noteStart = now + i * step;
      const noteEnd = noteStart + duration;

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      // Slight vibrato for the "chime" character.
      const vibrato = ctx.createOscillator();
      vibrato.type = 'sine';
      vibrato.frequency.value = 5.5;

      const vibratoGain = ctx.createGain();
      vibratoGain.gain.value = 3; // ±3 cents depth.

      vibrato.connect(vibratoGain);
      vibratoGain.connect(osc.detune);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, noteStart);
      env.gain.linearRampToValueAtTime(peakGain, noteStart + 0.025);
      env.gain.setTargetAtTime(0, noteEnd - 0.15, 0.08);

      osc.connect(env);
      env.connect(master);

      vibrato.start(noteStart);
      osc.start(noteStart);
      vibrato.stop(noteEnd + 0.1);
      osc.stop(noteEnd + 0.1);

      osc.addEventListener('ended', () => {
        try {
          osc.disconnect();
          vibrato.disconnect();
          vibratoGain.disconnect();
          env.disconnect();
        } catch { /* ignore */ }
      });
    });
  }
}

/**
 * Module-level singleton — survives GameView recreation (theme/lang/flip switch),
 * so ambient audio doesn't cut out when the realm rebuilds. Lazily constructed;
 * no AudioContext until resume() is called from a user gesture.
 */
let _realmAudio: RealmAudio | null = null;
export function getRealmAudio(): RealmAudio {
  return (_realmAudio ??= new RealmAudio());
}
