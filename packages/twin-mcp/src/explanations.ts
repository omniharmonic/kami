/**
 * Vendored from frontrange-twin web/src/copy/explanations.ts — prose © Front
 * Range Bioregional Twin contributors, CC BY-SA 4.0.
 *
 * The table below is copied verbatim (data only; keep it typed). Regenerate by
 * re-running the copy step in `scripts/refresh-fixtures.ts --explanations` or by
 * hand; do not edit the prose here. Bands exist only where a settled, citable
 * scale applies. Static copy, never a model output.
 */

export const EXPLANATIONS_LICENSE = "CC BY-SA 4.0";
export const EXPLANATIONS_ATTRIBUTION =
  "Front Range Bioregional Twin (bioregionaltwin.org), CC BY-SA 4.0";

export interface Band {
  /** Inclusive upper bound of the band, in the reading's published unit. */
  upTo: number;
  name: string;
  note: string;
}

export interface Explanation {
  label: string;
  /** One line under the value. ≤ 90 characters. */
  short: string;
  /** Two or three sentences: what it measures, how to read it, what high/low means here. */
  long: string;
  /** What the unit is, for someone who has never met it. */
  unitHelp?: string;
  /** Only where a settled scale exists; `source` cites it and `scale` names it for the headline. */
  bands?: Band[];
  scale?: string;
  source?: string;
}

const CFS =
  "cfs is cubic feet per second: how much water passes a point each second. One cfs is about 7.5 gallons — four basketballs — of water passing every second; a few hundred cfs is a creek you would think twice about wading.";
const FEET =
  "Feet above the gauge's own datum — a local zero, not sea level. Compare a gauge with itself over time, not with another gauge.";
const CELSIUS = "Degrees Celsius. 0 °C is freezing; 20 °C is a mild afternoon; 30 °C is a hot one.";
const INCHES = "Inches.";
const MM = "Millimetres; 25 mm is about an inch.";
const UGM3 = "Micrograms per cubic metre — the mass of particles in a cubic metre of air.";
const PPB = "Parts per billion of the gas in the air.";
const PERCENT = "Percent.";
const MPS =
  "Metres per second. Multiply by 2.2 for miles per hour; 5 m/s is a breeze that moves small branches.";
const ACREFEET =
  "Acre-feet: the water that would cover an acre a foot deep, about 326,000 gallons. Denver Water reckons one acre-foot serves about four households for a year.";

export const EXPLANATIONS: Record<string, Explanation> = {
  // --- water ---------------------------------------------------------------
  discharge: {
    label: "Discharge",
    short: "How much water is flowing past this gauge right now.",
    long: "Discharge is the volume of water passing the gauge each second. On Front Range creeks it peaks with snowmelt in late May and June, then falls through summer to a base flow fed by groundwater and reservoir releases. A sudden rise in a dry month usually means a storm upstream; a fall below the usual base flow means diversions or drought are biting.",
    unitHelp: CFS,
  },
  stage: {
    label: "Stage",
    short: "The water level at the gauge, measured from its own zero.",
    long: "Stage is the height of the water surface above a fixed point chosen for the gauge. It is what flood warnings are written in. A change in stage of a few inches can be a large change in flow on a wide, shallow reach, and a small one in a narrow canyon.",
    unitHelp: FEET,
  },
  gage_height: {
    label: "Gage height",
    short: "The water level at the gauge, measured from its own zero.",
    long: "Gage height is the USGS term for stage: the water surface above the gauge's datum. Rising gage height with rising discharge is normal snowmelt or rain; rising gage height with steady discharge can mean ice or debris backing the water up.",
    unitHelp: FEET,
  },
  water_temp: {
    label: "Water temperature",
    short: "How warm the stream is; trout and aquatic insects live within narrow limits.",
    long: "Water temperature drives what can live in a reach. Cold-water fish are stressed above about 20 °C and in real trouble above 25 °C, which is why late-summer afternoons on low, unshaded creeks matter. Snowmelt and reservoir bottom-releases run cold; wide, slow, sunlit water runs warm.",
    unitHelp: CELSIUS,
  },
  reservoir_storage: {
    label: "Reservoir storage",
    short: "How much water the reservoir is holding.",
    long: "Storage is the volume of water behind the dam. It rises through spring runoff and drops through the irrigation and municipal season. Reading it against the reservoir's capacity, where the source publishes one, says how full it is; the trend over weeks says how the year is going.",
    unitHelp: ACREFEET,
  },
  reservoir_fill: {
    label: "Reservoir fill",
    short: "How full the reservoir is, against its normal storage.",
    long: "Fill is the live storage reading divided by the dam's normal storage — the volume the reservoir is built to hold under its permit, published by Colorado Dam Safety. It is a ratio of two published numbers, not a forecast: above 100 % the reservoir is holding flood or surcharge water; a low figure in late summer is the irrigation season drawing it down, and the same figure in April says the runoff has not arrived.",
  },
  reservoir_elevation: {
    label: "Reservoir elevation",
    short: "The height of the reservoir's water surface.",
    long: "The water surface elevation of the reservoir. Storage is what matters for supply, but elevation is what the instrument actually measures, and on a steep-sided reservoir a foot of elevation is a lot of water.",
    unitHelp: "Feet, on the reservoir's own datum or above sea level depending on the operator.",
  },
  cdss_wlevel: {
    label: "Water level",
    short: "The water level reported by the state's telemetry at this structure.",
    long: "Colorado's Division of Water Resources reports water level at ditches, reservoirs and gauges it administers. It is read against the structure's own datum, so it is a trend to watch rather than a number to compare across sites.",
    unitHelp: FEET,
  },
  cdss_storag: {
    label: "Storage",
    short: "Water in storage at this structure, as reported by the state.",
    long: "Storage reported through the state's telemetry for a reservoir or pond it administers. Rising in spring and falling in summer is the normal shape of the year.",
    unitHelp: ACREFEET,
  },
  flow_forecast: {
    label: "Forecast flow",
    short: "A forecast, not a measurement — labelled so you can tell.",
    long: "This is the National Water Prediction Service's forecast of flow at this gauge, published alongside the measurement so the two can be compared. It is the one modelled number on this site and it is always labelled as a forecast.",
    unitHelp: CFS,
  },
  turbidity: {
    label: "Turbidity",
    short: "How cloudy the water is with suspended sediment.",
    long: "Turbidity measures how much light the water scatters, which tracks suspended silt and ash. It spikes with storms and with runoff from burn scars, and it is one of the first signs a fire's aftermath has reached the creek.",
    unitHelp: "FNU, formazin nephelometric units: clear mountain water reads under 5; a muddy flood reads in the hundreds.",
  },
  specific_conductance: {
    label: "Specific conductance",
    short: "How much dissolved mineral and salt the water carries.",
    long: "Conductance rises with dissolved ions. Snowmelt is very low; water that has run over shale, through irrigated fields or past road salt reads higher. A sharp rise during low flow usually means the stream is mostly groundwater and return flows.",
    unitHelp: "Microsiemens per centimetre.",
  },
  dissolved_oxygen: {
    label: "Dissolved oxygen",
    short: "Oxygen in the water, which fish and insects breathe.",
    long: "Cold, turbulent water holds more oxygen; warm, still water holds less, and algae consume it overnight. Readings below about 6 mg/L stress trout; below 4 is dangerous for most aquatic life.",
    unitHelp: "Milligrams of oxygen per litre of water.",
  },
  ph: {
    label: "pH",
    short: "How acidic or alkaline the water is.",
    long: "Most Front Range streams sit between 7 and 8.5. Drainage from old mines can push a creek acidic; heavy algae growth can push it alkaline in the afternoon. A steady value is the norm; a swing is the signal.",
    unitHelp: "pH units: 7 is neutral, lower is acidic, higher is alkaline.",
  },
  usgs_62614: {
    label: "Lake elevation",
    short: "The water surface elevation of the lake or reservoir.",
    long: "USGS parameter 62614: the lake surface elevation above the National Geodetic Vertical Datum of 1929. Read it as a trend; the absolute number is set by the survey datum, not by how full the lake is.",
    unitHelp: "Feet above the 1929 vertical datum.",
  },
  usgs_63160: {
    label: "Stream elevation",
    short: "The water surface elevation, referenced to sea level rather than the gauge.",
    long: "USGS parameter 63160: the stream's water surface elevation above the North American Vertical Datum of 1988. It is stage put on a common datum, so it can be compared with the elevation of a bridge deck or a floodplain.",
    unitHelp: "Feet above the 1988 vertical datum.",
  },

  // --- snow and precipitation ----------------------------------------------
  swe: {
    label: "Snow water equivalent",
    short: "How much water the snowpack holds if it all melted at once.",
    long: "Snow water equivalent is the depth of water you would get by melting the snow on the ground at this site. It is the number water managers watch, because it is next summer's river. It builds through winter, peaks around April at most Front Range sites, and melts out between May and July depending on elevation. Zero in September is normal, not broken.",
    unitHelp: "Inches of liquid water.",
  },
  snow_depth: {
    label: "Snow depth",
    short: "How deep the snow is on the ground at this site.",
    long: "Depth is what you would measure with a ruler. Fresh snow is light and deep; old, settled snow is shallow and dense, which is why depth can fall while snow water equivalent stays the same.",
    unitHelp: INCHES,
  },
  precip_accum: {
    label: "Precipitation (accumulated)",
    short: "Rain and snow since the start of the water year, 1 October.",
    long: "The season's total precipitation at this site, counted from 1 October. Compare it with the site's typical total to see whether the year is wet or dry; a jump of an inch overnight is a serious storm.",
    unitHelp: INCHES,
  },
  precip_5min: {
    label: "Precipitation (5 min)",
    short: "Rain in the last five minutes — the storm as it happens.",
    long: "How much rain fell in the last five-minute interval. Even a millimetre in five minutes is a hard shower; several millimetres is the kind of burst that sends debris flows off a burn scar.",
    unitHelp: MM,
  },
  usgs_00045: {
    label: "Precipitation",
    short: "Rain measured at this gauge.",
    long: "USGS parameter 00045: precipitation total recorded at the gauge. Read it with discharge and turbidity to see a storm arrive and the creek answer.",
    unitHelp: INCHES,
  },

  // --- air -------------------------------------------------------------------
  pm25: {
    label: "PM2.5",
    short: "Fine particles small enough to reach deep into the lungs; wildfire smoke is mostly this.",
    long: "PM2.5 counts particles under 2.5 micrometres across, the fraction that gets past the nose and throat. On the Front Range it comes from wildfire smoke, winter inversions and traffic. The bands below are the EPA's health breakpoints, revised in 2024; they apply to a 24-hour average, so a single hourly reading is an early warning rather than the verdict.",
    unitHelp: UGM3,
    bands: [
      { upTo: 9, name: "Good", note: "Air quality is satisfactory." },
      { upTo: 35.4, name: "Moderate", note: "Unusually sensitive people should consider limiting prolonged exertion." },
      { upTo: 55.4, name: "Unhealthy for sensitive groups", note: "People with heart or lung disease, older adults and children should limit prolonged exertion." },
      { upTo: 125.4, name: "Unhealthy", note: "Everyone may begin to experience effects; sensitive groups more serious ones." },
      { upTo: 225.4, name: "Very unhealthy", note: "Health alert: everyone may experience more serious effects." },
      { upTo: Number.POSITIVE_INFINITY, name: "Hazardous", note: "Emergency conditions; the entire population is likely to be affected." },
    ],
    scale: "the EPA 24-hour scale",
    source: "https://www.epa.gov/pm-pollution/final-reconsideration-national-ambient-air-quality-standards-particulate-matter-pm",
  },
  pm10: {
    label: "PM10",
    short: "Coarser dust and particles, from roads, fields and wind.",
    long: "PM10 counts particles under 10 micrometres — road dust, pollen, agricultural soil on a windy day. It rises on dry, windy afternoons and with construction. Less dangerous per microgram than PM2.5, but high values still irritate airways.",
    unitHelp: UGM3,
  },
  ozone: {
    label: "Ozone",
    short: "Ground-level ozone: summer's smog, worst on hot, still afternoons.",
    long: "Ground-level ozone forms when sunlight cooks vehicle and oil-and-gas emissions. The Front Range violates the federal standard most summers, and the worst hours are mid-afternoon on hot, calm days. The bands are the EPA's 8-hour breakpoints; an hourly reading over 70 ppb is a sign the day is heading into the unhealthy range.",
    unitHelp: PPB,
    bands: [
      { upTo: 54, name: "Good", note: "Air quality is satisfactory." },
      { upTo: 70, name: "Moderate", note: "Unusually sensitive people should consider limiting prolonged outdoor exertion." },
      { upTo: 85, name: "Unhealthy for sensitive groups", note: "Children, older adults and people with asthma should limit prolonged outdoor exertion." },
      { upTo: 105, name: "Unhealthy", note: "Everyone should limit prolonged outdoor exertion." },
      { upTo: 200, name: "Very unhealthy", note: "Everyone should avoid prolonged outdoor exertion." },
      { upTo: Number.POSITIVE_INFINITY, name: "Hazardous", note: "Everyone should avoid all outdoor exertion." },
    ],
    scale: "the EPA 8-hour scale",
    source:
      "https://document.airnow.gov/technical-assistance-document-for-the-reporting-of-daily-air-quailty.pdf",
  },
  no2: {
    label: "Nitrogen dioxide",
    short: "A traffic and combustion gas; a building block of ozone.",
    long: "Nitrogen dioxide comes mostly from vehicle engines and gas combustion. It is highest near busy roads at rush hour and in winter inversions, and it is one of the ingredients that becomes ozone on a sunny afternoon.",
    unitHelp: PPB,
  },
  so2: {
    label: "Sulphur dioxide",
    short: "A gas from burning coal and oil; rare on the Front Range now.",
    long: "Sulphur dioxide comes from coal plants, refineries and some industry. Readings near zero are normal here; a spike usually points at a specific stack upwind.",
    unitHelp: PPB,
  },
  co: {
    label: "Carbon monoxide",
    short: "An odourless gas from incomplete combustion — engines and fires.",
    long: "Carbon monoxide comes from engines, stoves and wildfire. Outdoor values are usually well under 1 ppm; several ppm near a road or in smoke is elevated.",
    unitHelp: "Parts per million.",
  },
  visibility: {
    label: "Visibility",
    short: "How far you can see — smoke and haze show up here first.",
    long: "Visibility is reported by airport sensors. On a clear Front Range day it is at its instrument maximum; smoke, dust and snow bring it down, and it is often the earliest station-level sign of a plume arriving.",
    unitHelp: "Metres. 16,000 m is the sensor's usual ceiling; under 5,000 m is noticeably hazy.",
  },

  // --- weather ---------------------------------------------------------------
  air_temp: {
    label: "Air temperature",
    short: "The temperature at the station, in the shade.",
    long: "Air temperature measured about two metres above the ground in a shaded, ventilated shelter. The Front Range often swings 15 °C or more between night and afternoon; a warm night after a hot day is what makes ozone and fire weather worse.",
    unitHelp: CELSIUS,
  },
  dewpoint: {
    label: "Dew point",
    short: "How much moisture the air holds; the lower it is, the drier the fuels.",
    long: "Dew point is the temperature the air would have to cool to for dew to form. It is a direct measure of moisture: a dew point below −5 °C on a warm day is the bone-dry air of red-flag fire weather; a dew point near the air temperature means fog or rain.",
    unitHelp: CELSIUS,
  },
  rh: {
    label: "Relative humidity",
    short: "How close the air is to saturated; single digits mean fire weather.",
    long: "Relative humidity is the moisture in the air as a share of what it could hold at this temperature. Front Range afternoons often sit around 20 percent; readings under 15 percent with wind are the conditions in which grass fires run.",
    unitHelp: PERCENT,
  },
  wind_speed: {
    label: "Wind speed",
    short: "How hard the wind is blowing, averaged over a few minutes.",
    long: "Sustained wind measured at the station. Downslope winds off the Divide can exceed 20 m/s along the foothills in winter; on a fire, wind speed is the number that matters most.",
    unitHelp: MPS,
  },
  wind_gust: {
    label: "Wind gust",
    short: "The strongest burst of wind in the reporting period.",
    long: "The peak gust rather than the average. Gusts are what bring branches and power lines down and what throw embers ahead of a fire; a gust half again above the sustained speed is ordinary, double is a windstorm.",
    unitHelp: MPS,
  },
  wind_dir: {
    label: "Wind direction",
    short: "Where the wind is coming from, in compass degrees.",
    long: "The direction the wind blows from: 0 is north, 90 east, 180 south, 270 west. Upslope easterlies bring moisture and storms to the foothills; westerly downslope winds are dry and, in fire season, dangerous.",
    unitHelp: "Degrees clockwise from north; the direction the wind comes from.",
  },
  pressure: {
    label: "Barometric pressure",
    short: "Air pressure at the station; falling fast means weather is coming.",
    long: "Pressure at the station's elevation. At a mile high the value is far below sea-level pressure, so compare a station with itself: a fall of several hectopascals in a few hours precedes a front.",
    unitHelp: "Pascals; 100 Pa is one hectopascal (millibar).",
  },
  solar_rad: {
    label: "Solar radiation",
    short: "Sunlight reaching the ground — clouds and smoke cut it.",
    long: "The energy of sunlight on a flat surface. On a clear Front Range noon in summer it approaches 1,000 W/m²; thick smoke or cloud can halve it, which is a useful measured stand-in for how heavy the smoke is.",
    unitHelp: "Watts per square metre.",
  },

  // --- soil ------------------------------------------------------------------
  soil_moisture: {
    label: "Soil moisture",
    short: "How wet the soil is at this depth.",
    long: "The share of the soil volume that is water, measured by a buried probe. Shallow probes respond to every shower; deeper ones track the season. Dry deep soil in spring means the snowmelt soaks in instead of running off, and the creeks get less of it.",
    unitHelp: "Percent of soil volume that is water.",
  },
  soil_temp: {
    label: "Soil temperature",
    short: "How warm the soil is at this depth.",
    long: "Soil temperature at a buried probe. Frozen soil sheds meltwater straight to the creek; thawed soil absorbs it. Deep soil temperature lags the air by weeks, which is why it is a steadier read on the season than the thermometer.",
    unitHelp: CELSIUS,
  },

  // --- classes of thing on the map --------------------------------------------
  "class:station": {
    label: "Monitoring site",
    short: "A place where an agency instrument takes readings.",
    long: "A stream gauge, snow pillow, weather station, air monitor or soil probe run by a public agency. Each carries its own readings, units and timestamps, republished here unchanged. A dot draws one ring per family of reading it carries, so a site with water and air readings shows both colours; a hollow dot means its latest reading is old.",
  },
  "class:fire": {
    label: "Wildfire incident",
    short: "An active incident reported to the national wildfire system.",
    long: "An incident from the national interagency fire reporting system, with its reported size and containment where given. Where a perimeter has been mapped it is drawn on the terrain; the point marks the incident's reported location.",
  },
  "class:detection": {
    label: "Satellite heat detection",
    short: "A hot spot seen from orbit in the last day — not a confirmed fire.",
    long: "A thermal anomaly detected by a satellite sensor. Most are fires, but hot roofs, flares and reflections also show up, and a single detection is a prompt to look, not a confirmed incident. Confidence and fire radiative power are the sensor's own measures of how sure and how hot.",
  },
  "class:alert": {
    label: "Weather alert",
    short: "An active watch, warning or advisory from the National Weather Service.",
    long: "An alert issued by the National Weather Service for the area drawn. Warnings mean the hazard is happening or imminent; watches mean conditions favour it; advisories are for lesser hazards. The alert's own text says what to do.",
  },
  "class:quake": {
    label: "Earthquake",
    short: "A recent earthquake located by the USGS.",
    long: "An earthquake from the USGS catalogue, drawn at its epicentre and sized by magnitude. Front Range quakes are usually small and shallow; 'automatic' means a computer located it and a person has not yet reviewed it.",
  },
  "class:drought": {
    label: "Drought class",
    short: "The US Drought Monitor's weekly assessment of drought severity.",
    long: "Each Thursday the US Drought Monitor draws drought severity across the country from precipitation, streamflow, soil moisture and local reports. D0 is abnormally dry; D4 is exceptional drought. It is an expert assessment, updated weekly, not a live measurement.",
    bands: [
      { upTo: 0, name: "D0 · Abnormally dry", note: "Going into or coming out of drought; short-term dryness slowing planting and growth." },
      { upTo: 1, name: "D1 · Moderate drought", note: "Some damage to crops and pastures; streams and reservoirs low; voluntary water restrictions." },
      { upTo: 2, name: "D2 · Severe drought", note: "Crop and pasture losses likely; water shortages common; restrictions imposed." },
      { upTo: 3, name: "D3 · Extreme drought", note: "Major crop and pasture losses; widespread water shortages." },
      { upTo: 4, name: "D4 · Exceptional drought", note: "Exceptional and widespread losses; emergencies from water shortages." },
    ],
    scale: "the Drought Monitor",
    source: "https://droughtmonitor.unl.edu/About/AbouttheData/DroughtClassification.aspx",
  },
};

/** Depth-suffixed soil keys resolve to the base entry: `soil_moisture_8in`. */
export const SOIL_DEPTH = /^soil_(moisture|temp)_(\d+)(in|cm)$/;

function verbatim(key: string): Explanation {
  const label = key.replace(/^class:/, "").replace(/_/g, " ");
  return {
    label,
    short: "A reading this site has no plain-language note for yet.",
    long: "This reading comes straight from its source with its unit and timestamp, but nobody has written a note about how to read it yet. The source link below is the place to look.",
  };
}

/** The twin's own resolver, unchanged: never throws. */
export function explainRaw(key: string): Explanation {
  const known = EXPLANATIONS[key];
  if (known) return known;
  const soil = SOIL_DEPTH.exec(key);
  if (soil) {
    const base = EXPLANATIONS[soil[1] === "temp" ? "soil_temp" : "soil_moisture"]!;
    return { ...base, label: `${base.label} at ${soil[2]} ${soil[3]}` };
  }
  return verbatim(key);
}

export interface OutputBand {
  /** Inclusive upper bound; `null` stands for +Infinity (JSON has no Infinity). */
  upTo: number | null;
  name: string;
  note: string;
}

export interface ExplainResult extends Omit<Explanation, "bands"> {
  key: string;
  bands?: OutputBand[];
  /** False when the key fell through to the verbatim sentinel. */
  known: boolean;
  license: typeof EXPLANATIONS_LICENSE;
  attribution: typeof EXPLANATIONS_ATTRIBUTION;
}

/** `explain` tool payload: the explanation plus its licence and attribution. */
export function explain(key: string): ExplainResult {
  const e = explainRaw(key);
  const known = key in EXPLANATIONS || SOIL_DEPTH.test(key);
  const out: ExplainResult = {
    key,
    known,
    label: e.label,
    short: e.short,
    long: e.long,
    license: EXPLANATIONS_LICENSE,
    attribution: EXPLANATIONS_ATTRIBUTION,
  };
  if (e.unitHelp) out.unitHelp = e.unitHelp;
  if (e.bands) out.bands = e.bands.map((b) => ({ name: b.name, note: b.note, upTo: Number.isFinite(b.upTo) ? b.upTo : null }));
  if (e.scale) out.scale = e.scale;
  if (e.source) out.source = e.source;
  return out;
}

/** The band a value falls in, where a settled scale exists; otherwise null. */
export function bandFor(key: string, value: number): Band | null {
  const bands = explainRaw(key).bands;
  if (!bands || !Number.isFinite(value)) return null;
  return bands.find((b) => value <= b.upTo) ?? null;
}

/** Every key in glossary order: water, snow, air, weather, soil, then the classes. */
export function glossaryKeys(): string[] {
  return Object.keys(EXPLANATIONS);
}
