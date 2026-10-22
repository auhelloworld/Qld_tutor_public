/**
 * 1D Force, Friction & Newton's Laws Pure Dynamics Model
 */

export interface MotionTracePoint {
  x: number;
  timeSec: number;
  velocity: number;
}

export interface ForceMotionState {
  massKg: number;
  appliedForceN: number;
  frictionEnabled: boolean;
  positionM: number;
  velocityMs: number;
  accelerationMs2: number;
  netForceN: number;
  frictionForceN: number;
  timeSec: number;
  trace: MotionTracePoint[];
}

interface ForceBalance {
  frictionForceN: number;
  netForceN: number;
  accelerationMs2: number;
}

/** Calculate the instantaneous horizontal force balance without advancing time. */
function calculateForceBalance(
  velocityMs: number,
  appliedForceN: number,
  frictionEnabled: boolean,
  massKg: number,
): ForceBalance {
  const safeMassKg = Math.max(0.1, massKg);
  const maxFrictionN = (frictionEnabled ? 0.2 : 0) * safeMassKg * 9.8;

  let frictionForceN: number;
  if (Math.abs(velocityMs) > 0.01) {
    frictionForceN = -Math.sign(velocityMs) * maxFrictionN;
  } else if (Math.abs(appliedForceN) <= maxFrictionN) {
    frictionForceN = -appliedForceN;
  } else {
    frictionForceN = -Math.sign(appliedForceN) * maxFrictionN;
  }

  const netForceN = appliedForceN + frictionForceN;
  return {
    frictionForceN,
    netForceN,
    accelerationMs2: netForceN / safeMassKg,
  };
}

export function initForceMotionState(
  massKg = 5,
  appliedForceN = 20,
  frictionEnabled = true,
): ForceMotionState {
  const balance = calculateForceBalance(0, appliedForceN, frictionEnabled, massKg);
  return {
    massKg,
    appliedForceN,
    frictionEnabled,
    positionM: 0,
    velocityMs: 0,
    accelerationMs2: Number(balance.accelerationMs2.toFixed(2)),
    netForceN: Number(balance.netForceN.toFixed(1)),
    frictionForceN: Number(balance.frictionForceN.toFixed(1)),
    timeSec: 0,
    trace: [{ x: 0, timeSec: 0, velocity: 0 }],
  };
}

export function stepForceMotion(
  state: ForceMotionState,
  dtSeconds: number,
  appliedForceN: number,
  frictionEnabled: boolean,
  massKg: number,
): ForceMotionState {
  const dt = Math.max(0, Math.min(dtSeconds, 0.05));
  const balance = calculateForceBalance(state.velocityMs, appliedForceN, frictionEnabled, massKg);
  const maxFrictionN = (frictionEnabled ? 0.2 : 0) * Math.max(0.1, massKg) * 9.8;
  let newVelocity = state.velocityMs + balance.accelerationMs2 * dt;

  // Check if friction stopped the object (prevent velocity oscillation around 0).
  if (
    state.velocityMs !== 0 &&
    Math.sign(newVelocity) !== Math.sign(state.velocityMs) &&
    Math.abs(appliedForceN) <= maxFrictionN
  ) {
    newVelocity = 0;
  }

  const newPosition = state.positionM + newVelocity * dt;
  const newTime = state.timeSec + dt;

  // Append trace every 0.1s up to max 50 points.
  let newTrace = state.trace;
  const lastTrace = state.trace[state.trace.length - 1];
  if (!lastTrace || newTime - lastTrace.timeSec >= 0.1) {
    newTrace = [...state.trace.slice(-49), { x: newPosition, timeSec: newTime, velocity: newVelocity }];
  }

  return {
    massKg,
    appliedForceN,
    frictionEnabled,
    positionM: Number(newPosition.toFixed(2)),
    velocityMs: Number(newVelocity.toFixed(2)),
    accelerationMs2: Number(balance.accelerationMs2.toFixed(2)),
    netForceN: Number(balance.netForceN.toFixed(1)),
    frictionForceN: Number(balance.frictionForceN.toFixed(1)),
    timeSec: Number(newTime.toFixed(2)),
    trace: newTrace,
  };
}
