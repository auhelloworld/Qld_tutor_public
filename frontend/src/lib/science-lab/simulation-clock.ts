/**
 * Fixed-step simulation clock helper for science simulations.
 */

export interface SimulationClockOptions {
  fixedDtSeconds?: number;
  maxSubSteps?: number;
  onStep: (dt: number) => void;
}

export class SimulationClock {
  private fixedDt: number;
  private maxSubSteps: number;
  private onStep: (dt: number) => void;
  private accumulator = 0;
  private lastTime: number | null = null;
  private animFrameId: number | null = null;
  private isRunning = false;

  constructor(options: SimulationClockOptions) {
    this.fixedDt = options.fixedDtSeconds ?? 1 / 60;
    this.maxSubSteps = options.maxSubSteps ?? 4;
    this.onStep = options.onStep;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = null;
    this.accumulator = 0;

    const tick = (now: number) => {
      if (!this.isRunning) return;
      if (this.lastTime === null) {
        this.lastTime = now;
      }
      const frameDeltaSec = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;
      this.accumulator += frameDeltaSec;

      let steps = 0;
      while (this.accumulator >= this.fixedDt && steps < this.maxSubSteps) {
        this.onStep(this.fixedDt);
        this.accumulator -= this.fixedDt;
        steps++;
      }
      if (steps >= this.maxSubSteps) {
        this.accumulator = 0; // Drop excess accumulated time to prevent spiral of death
      }

      this.animFrameId = requestAnimationFrame(tick);
    };

    this.animFrameId = requestAnimationFrame(tick);
  }

  public stepOnce(): void {
    this.onStep(this.fixedDt);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.lastTime = null;
    this.accumulator = 0;
  }

  public get running(): boolean {
    return this.isRunning;
  }
}
