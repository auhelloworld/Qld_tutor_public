/**
 * Carbon cycle and climate-energy teaching model.
 *
 * The model conserves carbon across four deliberately aggregated active
 * reservoirs. It is a classroom sensitivity model, not a forecast.
 */

export interface CarbonClimateSceneData {
  kind: 'carbon-climate';
  combustion: number;
  photosynthesis: number;
  oceanUptake: number;
  albedo: number;
  greenhouseGasPpm: number;
}

export type CarbonReservoirId = 'atmosphere' | 'biosphere' | 'hydrosphere' | 'geosphere';

export interface CarbonReservoir {
  id: CarbonReservoirId;
  label: string;
  carbonGt: number;
  changeGt: number;
}

export interface CarbonFlux {
  id: string;
  label: string;
  from: CarbonReservoirId;
  to: CarbonReservoirId;
  rateGtPerYear: number;
}

export interface CarbonClimatePoint {
  year: number;
  atmosphereGt: number;
  temperatureProxyC: number;
}

export interface CarbonClimateResult {
  reservoirs: Record<CarbonReservoirId, CarbonReservoir>;
  fluxes: CarbonFlux[];
  atmosphericChangeGtPerYear: number;
  projectedCo2Ppm: number;
  absorbedSolarWm2: number;
  outgoingLongwaveWm2: number;
  energyImbalanceWm2: number;
  temperatureProxyC: number;
  climateTendency: 'cooling' | 'near balance' | 'warming';
  projectionYears: number;
  trajectory: CarbonClimatePoint[];
}

export const CARBON_CLIMATE_MODEL_LIMITATIONS = [
  'Reservoirs are aggregated and fluxes are held constant during the 30-year teaching projection.',
  'The temperature value is an equilibrium sensitivity proxy, not a weather or regional-climate forecast.',
  'Clouds, aerosols, nutrient limits, ocean circulation, feedback delays and non-CO₂ gases are not resolved separately.',
] as const;

const PROJECTION_YEARS = 30;
const BASE_RESERVOIRS: Record<CarbonReservoirId, number> = {
  atmosphere: 870,
  biosphere: 550,
  hydrosphere: 38_000,
  geosphere: 4_000,
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  const finite = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, finite));
}

function round(value: number, places = 1): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function temperatureFromBalance(
  atmosphereChangeGt: number,
  year: number,
  albedo: number,
  greenhouseGasPpm: number,
): { co2Ppm: number; absorbed: number; outgoing: number; imbalance: number; temperature: number } {
  // 2.12 Gt C per ppm is a standard atmospheric conversion. The result is
  // intentionally a no-delay classroom proxy rather than a carbon-budget forecast.
  const co2Ppm = Math.max(180, greenhouseGasPpm + (atmosphereChangeGt * year) / 2.12);
  const greenhouseForcing = 5.35 * Math.log(co2Ppm / 280);
  const absorbed = 340 * (1 - albedo);
  const outgoing = 238 - greenhouseForcing;
  const imbalance = absorbed - outgoing;
  const temperature = imbalance * 0.22;
  return { co2Ppm, absorbed, outgoing, imbalance, temperature };
}

export function calculateCarbonClimate(
  sceneData: CarbonClimateSceneData,
): CarbonClimateResult {
  const combustion = clamp(sceneData.combustion, 0, 100, 50);
  const photosynthesis = clamp(sceneData.photosynthesis, 0, 100, 50);
  const oceanUptake = clamp(sceneData.oceanUptake, 0, 100, 50);
  const albedo = clamp(sceneData.albedo, 0.2, 0.45, 0.3);
  const greenhouseGasPpm = clamp(sceneData.greenhouseGasPpm, 280, 800, 420);

  // Gross fluxes in Gt C/year. Rates are quantised to the precision displayed by
  // the scene before the reservoir ledger is calculated, so the arrows, readout
  // and trajectory all describe the same transfers.
  const fluxes: CarbonFlux[] = [
    { id: 'combustion', label: 'Combustion', from: 'geosphere', to: 'atmosphere', rateGtPerYear: round(4 + combustion * 0.14) },
    { id: 'photosynthesis', label: 'Photosynthesis', from: 'atmosphere', to: 'biosphere', rateGtPerYear: round(90 + photosynthesis * 0.6) },
    { id: 'respiration', label: 'Respiration', from: 'biosphere', to: 'atmosphere', rateGtPerYear: 118 },
    { id: 'ocean-uptake', label: 'Ocean uptake', from: 'atmosphere', to: 'hydrosphere', rateGtPerYear: round(oceanUptake * 0.04) },
    { id: 'geological-release', label: 'Geological release', from: 'geosphere', to: 'atmosphere', rateGtPerYear: 0.2 },
  ];
  const reservoirIds = Object.keys(BASE_RESERVOIRS) as CarbonReservoirId[];

  // Constrain transfers at their source rather than clamping a negative endpoint.
  // Every reduced rate remains one paired source-to-destination transfer used by
  // both sides of the ledger. Rates only decrease in 0.1 Gt C/year steps, so the
  // loop reaches a stable, source-feasible set without an arbitrary iteration cap.
  let adjusted: boolean;
  do {
    adjusted = false;

    for (const source of reservoirIds) {
      const outgoing = fluxes.filter((flux) => flux.from === source);
      const outgoingRate = outgoing.reduce((sum, flux) => sum + flux.rateGtPerYear, 0);
      const incomingRate = fluxes
        .filter((flux) => flux.to === source)
        .reduce((sum, flux) => sum + flux.rateGtPerYear, 0);
      const availableRate = BASE_RESERVOIRS[source] / PROJECTION_YEARS + incomingRate;

      if (outgoingRate <= availableRate + 1e-9) continue;

      const scale = availableRate / outgoingRate;
      for (const flux of outgoing) {
        // Round down to the displayed 0.1 Gt C/year precision so a constrained
        // source can never be overdrawn by rate rounding.
        const constrainedRate = Math.max(
          0,
          Math.floor((flux.rateGtPerYear * scale + 1e-9) * 10) / 10,
        );
        if (constrainedRate < flux.rateGtPerYear) {
          flux.rateGtPerYear = constrainedRate;
          adjusted = true;
        }
      }
    }
  } while (adjusted);

  const balanceRates = reservoirIds.reduce(
    (record, id) => {
      record[id] = 0;
      return record;
    },
    {} as Record<CarbonReservoirId, number>,
  );
  for (const flux of fluxes) {
    balanceRates[flux.from] -= flux.rateGtPerYear;
    balanceRates[flux.to] += flux.rateGtPerYear;
  }

  const reservoirChanges = reservoirIds.reduce(
    (record, id) => {
      record[id] = round(balanceRates[id] * PROJECTION_YEARS);
      return record;
    },
    {} as Record<CarbonReservoirId, number>,
  );
  const atmosphericChange = round(balanceRates.atmosphere);

  const reservoirLabels: Record<CarbonReservoirId, string> = {
    atmosphere: 'Atmosphere',
    biosphere: 'Biosphere',
    hydrosphere: 'Hydrosphere',
    geosphere: 'Geosphere',
  };

  const reservoirs = reservoirIds.reduce(
    (record, id) => {
      record[id] = {
        id,
        label: reservoirLabels[id],
        carbonGt: round(BASE_RESERVOIRS[id] + reservoirChanges[id]),
        changeGt: reservoirChanges[id],
      };
      return record;
    },
    {} as Record<CarbonReservoirId, CarbonReservoir>,
  );

  const finalEnergy = temperatureFromBalance(
    atmosphericChange,
    PROJECTION_YEARS,
    albedo,
    greenhouseGasPpm,
  );
  const trajectory = Array.from({ length: 11 }, (_, index) => {
    const year = index * 3;
    const energy = temperatureFromBalance(atmosphericChange, year, albedo, greenhouseGasPpm);
    return {
      year,
      atmosphereGt: round(BASE_RESERVOIRS.atmosphere + atmosphericChange * year),
      temperatureProxyC: round(energy.temperature, 2),
    };
  });

  const climateTendency = finalEnergy.imbalance > 0.5
    ? 'warming'
    : finalEnergy.imbalance < -0.5
      ? 'cooling'
      : 'near balance';

  return {
    reservoirs,
    fluxes,
    atmosphericChangeGtPerYear: atmosphericChange,
    projectedCo2Ppm: round(finalEnergy.co2Ppm),
    absorbedSolarWm2: round(finalEnergy.absorbed),
    outgoingLongwaveWm2: round(finalEnergy.outgoing),
    energyImbalanceWm2: round(finalEnergy.imbalance, 2),
    temperatureProxyC: round(finalEnergy.temperature, 2),
    climateTendency,
    projectionYears: PROJECTION_YEARS,
    trajectory,
  };
}
