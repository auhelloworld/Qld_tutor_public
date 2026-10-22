/**
 * Solar Geometry & Earth-Sun-Moon Pure Physical Model
 * Strict deterministic mathematical calculations.
 */

export interface SolarGeometryResult {
  dayOfYear: number;
  monthName: string;
  solarDeclinationDeg: number;
  noonSolarAltitudeDeg: number;
  daylightHours: number;
  solarIntensityPercent: number;
  southernSeason: string;
  northernSeason: string;
  orbitalAngleRad: number;
  isEquinox: boolean;
  isSolstice: boolean;
}

const MONTH_DAYS = [
  { name: 'January', days: 31 },
  { name: 'February', days: 28 },
  { name: 'March', days: 31 },
  { name: 'April', days: 30 },
  { name: 'May', days: 31 },
  { name: 'June', days: 30 },
  { name: 'July', days: 31 },
  { name: 'August', days: 31 },
  { name: 'September', days: 30 },
  { name: 'October', days: 31 },
  { name: 'November', days: 30 },
  { name: 'December', days: 31 },
];

export function getMonthFromDay(dayOfYear: number): { monthName: string; dayOfMonth: number; monthIndex: number } {
  let remaining = Math.max(1, Math.min(365, Math.round(dayOfYear)));
  for (let i = 0; i < MONTH_DAYS.length; i++) {
    if (remaining <= MONTH_DAYS[i].days) {
      return { monthName: MONTH_DAYS[i].name, dayOfMonth: remaining, monthIndex: i + 1 };
    }
    remaining -= MONTH_DAYS[i].days;
  }
  return { monthName: 'December', dayOfMonth: 31, monthIndex: 12 };
}

export function calculateSolarGeometry(
  dayOfYear: number,
  latitudeDeg: number,
  axialTiltDeg = 23.5,
): SolarGeometryResult {
  const day = Math.max(1, Math.min(365, dayOfYear));
  const { monthName, monthIndex } = getMonthFromDay(day);

  // March 21 is approximately day 80 (Equinox: declination = 0)
  const orbitalAngleRad = (2 * Math.PI * (day - 80)) / 365;
  const solarDeclinationDeg = axialTiltDeg * Math.sin(orbitalAngleRad);

  const phiRad = (latitudeDeg * Math.PI) / 180;
  const deltaRad = (solarDeclinationDeg * Math.PI) / 180;

  // Noon Solar Altitude = 90° - |Latitude - Declination|
  const zenithAngleDeg = Math.abs(latitudeDeg - solarDeclinationDeg);
  const noonSolarAltitudeDeg = Math.max(0, Math.min(90, 90 - zenithAngleDeg));

  // Daylight duration via standard solar hour angle equation
  let daylightHours = 12;
  if (Math.abs(axialTiltDeg) < 1e-4) {
    daylightHours = 12.0;
  } else {
    const cosArg = -Math.tan(phiRad) * Math.tan(deltaRad);
    if (cosArg >= 1.0) {
      daylightHours = 0.0; // Polar Night
    } else if (cosArg <= -1.0) {
      daylightHours = 24.0; // Midnight Sun
    } else {
      const omega0 = Math.acos(cosArg);
      daylightHours = (24 * omega0) / Math.PI;
    }
  }

  // Normalized relative solar intensity
  const altitudeSin = Math.sin((noonSolarAltitudeDeg * Math.PI) / 180);
  const durationFactor = daylightHours / 12.0;
  const solarIntensityPercent = Math.max(
    0,
    Math.min(100, Math.round(altitudeSin * durationFactor * 100)),
  );

  // Southern & Northern Hemisphere Season
  let southernSeason: string;
  let northernSeason: string;
  if (monthIndex === 12 || monthIndex === 1 || monthIndex === 2) {
    southernSeason = 'Summer';
    northernSeason = 'Winter';
  } else if (monthIndex >= 3 && monthIndex <= 5) {
    southernSeason = 'Autumn';
    northernSeason = 'Spring';
  } else if (monthIndex >= 6 && monthIndex <= 8) {
    southernSeason = 'Winter';
    northernSeason = 'Summer';
  } else {
    southernSeason = 'Spring';
    northernSeason = 'Autumn';
  }

  const isEquinox = Math.abs(solarDeclinationDeg) < 0.5;
  const isSolstice = Math.abs(Math.abs(solarDeclinationDeg) - axialTiltDeg) < 0.5;

  return {
    dayOfYear: day,
    monthName,
    solarDeclinationDeg: Number(solarDeclinationDeg.toFixed(2)),
    noonSolarAltitudeDeg: Number(noonSolarAltitudeDeg.toFixed(1)),
    daylightHours: Number(daylightHours.toFixed(2)),
    solarIntensityPercent,
    southernSeason,
    northernSeason,
    orbitalAngleRad,
    isEquinox,
    isSolstice,
  };
}
