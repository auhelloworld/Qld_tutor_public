/**
 * Idealised 2D particle motion model for states, diffusion, and dissolving.
 *
 * Coordinates and velocities use canvas units. The model includes seeded thermal
 * motion and wall reflections only; it does not implement hard-sphere collisions
 * or intermolecular force potentials.
 */

import { createSeededRandom } from '../seeded-random';

const DEFAULT_PARTICLE_COUNT = 120;
const MAX_PARTICLE_COUNT = 250;
const BASELINE_SPEED_PX_PER_SEC = 40;

export interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  kind: 'solvent' | 'solute';
  homeX?: number;
  homeY?: number;
}

export interface ParticleSystemState {
  particles: Particle[];
  width: number;
  height: number;
  mode: 'states' | 'diffusion' | 'dissolving';
  temperatureK: number;
  timeSec: number;
  seed: number;
  /** Number of deterministic model steps already applied. */
  stepCount?: number;
}

export interface ParticleMetrics {
  /** @deprecated Canvas speed retained for API compatibility. Prefer meanSpeedPxPerSec. */
  avgSpeed: number;
  meanSpeedPxPerSec: number;
  relativeSpeed: number;
  /** Actual mean nearest-neighbour centre spacing in canvas pixels. */
  meanSpacingPx: number;
  /** Unitless thermal pressure proxy, normalised to 1 near 300 K and 120 particles. */
  relativePressure: number;
  /** @deprecated Unitless compatibility alias. It must not be presented as kPa. */
  gasPressureKpa: number;
  stateLabel: string;
  soluteDispersionScore: number;
}

function normaliseParticleCount(particleCount: number): number {
  if (!Number.isFinite(particleCount)) return DEFAULT_PARTICLE_COUNT;
  return Math.min(MAX_PARTICLE_COUNT, Math.max(1, Math.round(particleCount)));
}

function seededStepRandom(seed: number, stepCount: number): () => number {
  const mixedSeed = (seed + Math.imul(stepCount + 1, 0x9e3779b1)) >>> 0;
  return createSeededRandom(mixedSeed);
}

export function initParticleSystem(
  mode: 'states' | 'diffusion' | 'dissolving',
  temperatureK = 300,
  width = 400,
  height = 300,
  seed = 42,
  particleCount = DEFAULT_PARTICLE_COUNT,
): ParticleSystemState {
  const rng = createSeededRandom(seed);
  const particles: Particle[] = [];
  const count = normaliseParticleCount(particleCount);
  let id = 0;

  const addMovingParticle = (
    kind: Particle['kind'],
    x: number,
    y: number,
    radius: number,
    speedScale: number,
  ) => {
    const angle = rng() * Math.PI * 2;
    const speed = Math.sqrt(temperatureK / 300) * speedScale;
    particles.push({
      id: id++,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      kind,
    });
  };

  if (mode === 'states') {
    const cols = Math.max(1, Math.ceil(Math.sqrt(count * (width / height))));
    const rows = Math.max(1, Math.ceil(count / cols));
    const startX = width * 0.15;
    const startY = height * 0.15;
    const spacingX = cols > 1 ? (width * 0.7) / (cols - 1) : 0;
    const spacingY = rows > 1 ? (height * 0.7) / (rows - 1) : 0;

    for (let index = 0; index < count; index++) {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const homeX = startX + col * spacingX;
      const homeY = startY + row * spacingY;
      const angle = rng() * Math.PI * 2;
      const speed = Math.sqrt(temperatureK / 300) * 30;
      particles.push({
        id: id++,
        x: homeX + (rng() - 0.5) * 4,
        y: homeY + (rng() - 0.5) * 4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 5,
        kind: 'solvent',
        homeX,
        homeY,
      });
    }
  } else if (mode === 'diffusion') {
    const soluteCount = Math.max(1, Math.round(count / 3));
    const solventCount = count - soluteCount;

    for (let index = 0; index < solventCount; index++) {
      addMovingParticle(
        'solvent',
        width * 0.4 + rng() * width * 0.55,
        height * 0.1 + rng() * height * 0.8,
        5,
        35,
      );
    }
    for (let index = 0; index < soluteCount; index++) {
      addMovingParticle(
        'solute',
        width * 0.05 + rng() * width * 0.3,
        height * 0.1 + rng() * height * 0.8,
        6,
        35,
      );
    }
  } else {
    const soluteCount = Math.max(1, Math.round(count * 0.25));
    const solventCount = count - soluteCount;

    for (let index = 0; index < solventCount; index++) {
      addMovingParticle(
        'solvent',
        width * 0.05 + rng() * width * 0.9,
        height * 0.05 + rng() * height * 0.65,
        5,
        30,
      );
    }

    const blockCols = Math.max(1, Math.ceil(Math.sqrt(soluteCount)));
    const blockRows = Math.max(1, Math.ceil(soluteCount / blockCols));
    const blockSpacing = 14;
    const blockStartX = (width - (blockCols - 1) * blockSpacing) / 2;
    const blockStartY = Math.min(
      height - 6 - (blockRows - 1) * blockSpacing,
      height * 0.72,
    );

    for (let index = 0; index < soluteCount; index++) {
      const row = Math.floor(index / blockCols);
      const col = index % blockCols;
      const homeX = blockStartX + col * blockSpacing;
      const homeY = blockStartY + row * blockSpacing;
      particles.push({
        id: id++,
        x: homeX,
        y: homeY,
        vx: 0,
        vy: 0,
        radius: 6,
        kind: 'solute',
        homeX,
        homeY,
      });
    }
  }

  return {
    particles,
    width,
    height,
    mode,
    temperatureK,
    timeSec: 0,
    seed,
    stepCount: 0,
  };
}

function meanNearestNeighbourSpacing(particles: Particle[]): number {
  if (particles.length < 2) return 0;

  let totalNearestDistance = 0;
  for (let index = 0; index < particles.length; index++) {
    const particle = particles[index];
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let otherIndex = 0; otherIndex < particles.length; otherIndex++) {
      if (otherIndex === index) continue;
      const other = particles[otherIndex];
      nearestDistance = Math.min(
        nearestDistance,
        Math.hypot(particle.x - other.x, particle.y - other.y),
      );
    }

    totalNearestDistance += nearestDistance;
  }

  return Number((totalNearestDistance / particles.length).toFixed(1));
}

export function measureParticleSystem(
  state: ParticleSystemState,
  temperatureK = state.temperatureK,
): ParticleMetrics {
  let totalSpeed = 0;
  for (const particle of state.particles) {
    totalSpeed += Math.hypot(particle.vx, particle.vy);
  }

  const count = state.particles.length;
  const meanSpeedPxPerSec = Number((totalSpeed / Math.max(1, count)).toFixed(1));
  const relativeSpeed = Number((meanSpeedPxPerSec / BASELINE_SPEED_PX_PER_SEC).toFixed(2));
  const meanSpacingPx = meanNearestNeighbourSpacing(state.particles);
  const relativePressure = Number(
    ((temperatureK / 300) * (count / DEFAULT_PARTICLE_COUNT)).toFixed(2),
  );

  let stateLabel = 'Liquid';
  if (temperatureK < 200) stateLabel = 'Solid';
  else if (temperatureK >= 420) stateLabel = 'Gas';

  const soluteParticles = state.particles.filter((particle) => particle.kind === 'solute');
  let soluteDispersionScore = 0;
  if (soluteParticles.length > 0) {
    const meanX =
      soluteParticles.reduce((sum, particle) => sum + particle.x, 0) /
      soluteParticles.length;
    const normalizedSpread = Math.min(1, meanX / (state.width * 0.5));
    soluteDispersionScore = Math.round(normalizedSpread * 100);
  }

  return {
    avgSpeed: meanSpeedPxPerSec,
    meanSpeedPxPerSec,
    relativeSpeed,
    meanSpacingPx,
    relativePressure,
    gasPressureKpa: relativePressure,
    stateLabel,
    soluteDispersionScore,
  };
}

export function stepParticleSystem(
  state: ParticleSystemState,
  dtSeconds: number,
  temperatureK: number,
): { state: ParticleSystemState; metrics: ParticleMetrics } {
  const dt = Number.isFinite(dtSeconds)
    ? Math.max(0, Math.min(dtSeconds, 0.05))
    : 0;
  const targetSpeed = Math.sqrt(temperatureK / 300) * BASELINE_SPEED_PX_PER_SEC;
  const isSolid = temperatureK < 200 && state.mode === 'states';
  const stepCount = state.stepCount ?? 0;
  const rng = seededStepRandom(state.seed, stepCount);

  const nextParticles: Particle[] = state.particles.map((particle) => {
    let vx = particle.vx;
    let vy = particle.vy;

    if (dt > 0 && isSolid && particle.homeX !== undefined && particle.homeY !== undefined) {
      const springStrength = 180;
      const damping = Math.exp(-5 * dt);
      const dx = particle.x - particle.homeX;
      const dy = particle.y - particle.homeY;
      vx = (vx - springStrength * dx * dt) * damping;
      vy = (vy - springStrength * dy * dt) * damping;

      const speed = Math.hypot(vx, vy);
      const desiredSpeed = (temperatureK / 200) * 15;
      if (speed < desiredSpeed * 0.5) {
        const angle = rng() * Math.PI * 2;
        const kick = desiredSpeed * (0.25 + rng() * 0.25);
        vx += Math.cos(angle) * kick;
        vy += Math.sin(angle) * kick;
      }
    } else if (dt > 0) {
      const currentSpeed = Math.hypot(vx, vy);
      if (currentSpeed > 0) {
        const relaxation = 1 - Math.exp(-3 * dt);
        const adjustedSpeed = currentSpeed + (targetSpeed - currentSpeed) * relaxation;
        const speedFactor = adjustedSpeed / currentSpeed;
        vx *= speedFactor;
        vy *= speedFactor;
      } else {
        const angle = rng() * Math.PI * 2;
        vx = Math.cos(angle) * targetSpeed;
        vy = Math.sin(angle) * targetSpeed;
      }
    }

    let x = particle.x + vx * dt;
    let y = particle.y + vy * dt;
    const padding = particle.radius;

    if (x < padding) {
      x = padding;
      vx = Math.abs(vx);
    } else if (x > state.width - padding) {
      x = state.width - padding;
      vx = -Math.abs(vx);
    }

    if (y < padding) {
      y = padding;
      vy = Math.abs(vy);
    } else if (y > state.height - padding) {
      y = state.height - padding;
      vy = -Math.abs(vy);
    }

    return { ...particle, x, y, vx, vy };
  });

  const nextState: ParticleSystemState = {
    ...state,
    particles: nextParticles,
    temperatureK,
    timeSec: state.timeSec + dt,
    stepCount: dt > 0 ? stepCount + 1 : stepCount,
  };

  return {
    state: nextState,
    metrics: measureParticleSystem(nextState, temperatureK),
  };
}
