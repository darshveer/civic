/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-city authoritative ward -> zone maps. Each municipality publishes its own
 * ward/zone list, so each city gets its own entry here. Bengaluru (BBMP) is the
 * official 243-ward list (zone/AC-wise mapping). Ward keys are normalised
 * (lowercase, single-spaced). When a geocoded ward is NOT in the map, callers
 * fall back to the LLM zone-mapping agent.
 */

export interface CityZoneMap {
  state: string;
  zones: string[];
  wardToZone: Record<string, string>;
}

export function normalizeName(s: string | undefined): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export const CITY_ZONE_MAPS: Record<string, CityZoneMap> = {
  bengaluru: {
    state: "Karnataka",
    zones: ["Bommanahalli","Dasarahalli","East","Mahadevapura","RR Nagar","South","West","Yelahanka"],
    wardToZone: {
    "a narayanapura": "Mahadevapura",
    "adugodi": "South",
    "aecs layout": "Mahadevapura",
    "agara": "Bommanahalli",
    "agaram": "East",
    "agrahara dasarahalli": "West",
    "amrutahalli": "Yelahanka",
    "anjanapura": "Bommanahalli",
    "arakere": "Bommanahalli",
    "aramane nagara": "West",
    "ashoka pillar": "South",
    "attiguppe": "South",
    "atturu layout": "Yelahanka",
    "avalahalli": "South",
    "azad nagar": "West",
    "babusab palya": "Mahadevapura",
    "bagalakunte": "Dasarahalli",
    "banasavadi": "East",
    "banashankari temple ward": "South",
    "bande mutt": "RR Nagar",
    "bapuji nagar": "South",
    "basavanagudi": "South",
    "basavanapura": "Mahadevapura",
    "basaveshwara nagar": "West",
    "begur": "Bommanahalli",
    "belathur": "Mahadevapura",
    "bellanduru": "Mahadevapura",
    "bharathi nagar": "East",
    "bilekhalli": "Bommanahalli",
    "binnipete": "West",
    "bommanahalli": "Bommanahalli",
    "btm layout": "South",
    "byatarayanapura": "Yelahanka",
    "byrasandra": "South",
    "c v raman nagar": "East",
    "chalavadipalya": "West",
    "chamrajapet": "West",
    "chamundi nagara": "East",
    "chanakya": "RR Nagar",
    "chandra layout": "West",
    "chatrapati shivaji": "RR Nagar",
    "chickpete": "West",
    "chokkasandra": "Dasarahalli",
    "chowdeswari ward": "Yelahanka",
    "chunchaghatta": "Bommanahalli",
    "cottonpete": "West",
    "dattatreya temple": "West",
    "dayananda nagar": "West",
    "deen dayalu ward": "South",
    "defence colony": "Dasarahalli",
    "devara jeevanahalli": "East",
    "devarachikkanahalli": "Bommanahalli",
    "devaraj urs nagar": "West",
    "devasandra": "Mahadevapura",
    "dharmaraya swamy temple ward": "South",
    "dodda bidarakallu": "RR Nagar",
    "dodda bommasandra": "Yelahanka",
    "doddagollarahatti": "RR Nagar",
    "doddakanahalli": "Mahadevapura",
    "doddanekkundi": "Mahadevapura",
    "domlur": "East",
    "dr. raj kumar ward": "West",
    "ejipura": "South",
    "gali anjenaya temple ward": "South",
    "gandhinagar": "West",
    "ganesh mandir ward": "South",
    "ganga nagar": "East",
    "garudachar playa": "Mahadevapura",
    "gayithri nagar": "West",
    "girinagar": "South",
    "gottigere": "Bommanahalli",
    "govindaraja nagar": "West",
    "gurappanapalya": "South",
    "hagadur": "Mahadevapura",
    "hal airport": "Mahadevapura",
    "hampi nagar": "South",
    "hanumanth nagar": "South",
    "hebbala": "East",
    "hegganahalli": "Dasarahalli",
    "hemmigepura": "RR Nagar",
    "hennur": "East",
    "herohalli": "RR Nagar",
    "hombegowda nagara": "South",
    "hongasandra": "Bommanahalli",
    "horamavu": "Mahadevapura",
    "hosahalli": "South",
    "hosakerehalli": "South",
    "hoysala nagar": "East",
    "hrbr layout": "East",
    "hsr-singasandra": "Bommanahalli",
    "hudi": "Mahadevapura",
    "hulimavu": "Bommanahalli",
    "ibluru": "Bommanahalli",
    "j p nagar": "South",
    "j p park": "RR Nagar",
    "jagajivanaram nagar": "West",
    "jai maruthinagara": "West",
    "jakkasandra": "South",
    "jakkuru": "Yelahanka",
    "jalakanteshwara nagara": "East",
    "jaraganahalli": "Bommanahalli",
    "jayachamarajendra nagar": "East",
    "jayamahal": "East",
    "jeevanbhima nagar": "East",
    "jnana bharathi": "RR Nagar",
    "jogupalya": "East",
    "k r puram": "Mahadevapura",
    "kacharkanahalli": "East",
    "kadu malleshwara": "West",
    "kadugodi": "Mahadevapura",
    "kadugondanahalli": "East",
    "kalena agrahara": "Bommanahalli",
    "kalkere": "Mahadevapura",
    "kamakshipalya": "West",
    "kamakya nagar": "South",
    "kammagondanahalli": "Dasarahalli",
    "kammanahalli": "East",
    "kanneshwara": "RR Nagar",
    "katriguppe": "South",
    "kaval bairasandra": "East",
    "kaveripura": "West",
    "kempapura": "Yelahanka",
    "kempapura agrahara": "South",
    "kempegowda ward": "Yelahanka",
    "kengeri": "RR Nagar",
    "kodigehalli": "Yelahanka",
    "kogilu": "Yelahanka",
    "konanakunte": "Bommanahalli",
    "konena agrahara": "East",
    "koramangala": "South",
    "kudlu": "Bommanahalli",
    "kumaraswamy layout": "South",
    "kushal nagar": "East",
    "kuvempunagar": "Yelahanka",
    "lakkasandra": "South",
    "lakshmi devi nagar": "RR Nagar",
    "lal bahadur nagar": "East",
    "lingarajapura": "East",
    "madivala": "South",
    "mahadevapura": "Mahadevapura",
    "mahalakshimpuram": "West",
    "mallasandra": "Dasarahalli",
    "malleswaram": "West",
    "mangammanapalya": "Bommanahalli",
    "manorayanapalya": "East",
    "marappana palya": "West",
    "marathahalli": "Mahadevapura",
    "marenahalli": "West",
    "maruthi mandir ward": "West",
    "maruthi seva nagar": "East",
    "mattikere": "West",
    "medahalli": "Mahadevapura",
    "mudalapalya": "West",
    "muneshwara nagar": "East",
    "munnekollala": "Mahadevapura",
    "n s palya": "South",
    "naganathapura": "Bommanahalli",
    "nagapura": "West",
    "nagarabhavi": "West",
    "nagavara": "East",
    "nalvadi krishnaraja wadior park": "RR Nagar",
    "nandini layout": "West",
    "nayandahalli": "West",
    "neelasandra": "East",
    "nelagadderanahalli": "Dasarahalli",
    "new bayappanahalli": "East",
    "new thippasandra": "East",
    "okalipuram": "West",
    "old thippasandra": "East",
    "padarayanapura": "West",
    "padmanabha nagar": "South",
    "peenya": "RR Nagar",
    "prakash nagar": "West",
    "pulikeshinagar": "East",
    "puneet rajkumar": "West",
    "puttenahalli- sarakki lake": "Bommanahalli",
    "radhakrishna temple ward": "East",
    "rajagopal nagar": "Dasarahalli",
    "rajaji nagar": "West",
    "rajamahal guttahalli": "West",
    "rajarajeshwari nagar": "RR Nagar",
    "rajeshwari nagar": "Dasarahalli",
    "ramamurthy nagara": "Mahadevapura",
    "ramaswamy palya": "East",
    "ranadheera kanteerava": "RR Nagar",
    "rbi layout": "Bommanahalli",
    "rupenaagrahara": "Bommanahalli",
    "s k garden": "East",
    "sagayarapuram": "East",
    "sampangiram nagar": "East",
    "sanjaya nagar": "East",
    "sarakki": "South",
    "shakambari nagar": "South",
    "shakthi ganapathi nagar": "West",
    "shankar matt": "West",
    "shantala nagar": "East",
    "shanthi nagar": "East",
    "shettihalli": "Dasarahalli",
    "shivanagara": "West",
    "sir m vishweshwaraiah": "RR Nagar",
    "someshwara nagar": "South",
    "someshwara ward": "Yelahanka",
    "srinagar": "South",
    "srinivasa nagar": "South",
    "sriramamandir": "West",
    "subhash nagar": "West",
    "subramanya nagar": "West",
    "subramanyapura": "Bommanahalli",
    "suddagunte palya": "South",
    "sudham nagara": "South",
    "sunkadakatte": "Dasarahalli",
    "sunkenahalli": "South",
    "t dasarahalli": "Dasarahalli",
    "thanisandra": "Yelahanka",
    "tilak nagar": "South",
    "ullal": "RR Nagar",
    "ulsoor": "East",
    "umamaheshwari ward": "South",
    "uttarahalli": "Bommanahalli",
    "vannarapete": "East",
    "varthuru": "Mahadevapura",
    "vasanth nagar": "East",
    "vasanthpura": "Bommanahalli",
    "veera sindhura lakshamana": "RR Nagar",
    "veerabhadranagar": "South",
    "veeramadakari": "RR Nagar",
    "venkateshpura": "East",
    "vidyamanyanagar": "RR Nagar",
    "vidyapeeta ward": "South",
    "vidyaranyapura": "Yelahanka",
    "vijayanagar": "South",
    "vijayanagara krishnadevaraya": "RR Nagar",
    "vijinapura": "Mahadevapura",
    "vijnana nagar": "Mahadevapura",
    "vikram nagar": "South",
    "vinayakanagar": "Bommanahalli",
    "vishveshwara puram": "South",
    "vishwanath nagenahalli": "East",
    "vrisabhavathi nagar": "West",
    "whitefield": "Mahadevapura",
    "yediyur": "South",
    "yelachenahalli": "Bommanahalli",
    "yelahanka satellite town": "Yelahanka",
    },
  },
};
// Common aliases for the same municipality.
CITY_ZONE_MAPS.bangalore = CITY_ZONE_MAPS.bengaluru;
CITY_ZONE_MAPS["bengaluru urban"] = CITY_ZONE_MAPS.bengaluru;
CITY_ZONE_MAPS["bbmp"] = CITY_ZONE_MAPS.bengaluru;

/** Returns the authoritative map for a city, or null if none is configured. */
export function cityMapFor(city: string | undefined): CityZoneMap | null {
  return CITY_ZONE_MAPS[normalizeName(city)] || null;
}

/** The official zone for a (city, ward), or undefined if not in the map. */
export function resolveZoneAuthoritative(
  city: string | undefined,
  ward: string | undefined,
): string | undefined {
  const m = cityMapFor(city);
  if (!m) return undefined;
  return m.wardToZone[normalizeName(ward)];
}

/** The list of zones for a city (for dropdowns). */
export function zonesForCity(city: string | undefined): string[] {
  return cityMapFor(city)?.zones || [];
}

/** The list of ward names for a city (for dropdowns), Title-cased from keys. */
export function wardsForCity(city: string | undefined): string[] {
  const m = cityMapFor(city);
  if (!m) return [];
  return Object.keys(m.wardToZone).sort();
}

/** The state a city is served under (for cross-state sanity checks). */
export function servedState(city: string | undefined): string | undefined {
  return cityMapFor(city)?.state;
}
