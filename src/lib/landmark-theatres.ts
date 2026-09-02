import type { Theatre } from "./types";

export type LandmarkTheatre = Theatre & {
  provider: "landmark";
  slug: string;
  timeZone: string;
};

export const LANDMARK_THEATRES: readonly LandmarkTheatre[] = [
  landmarkTheatre("181", "brandon", "Brandon", "Unit 100 - 1570 18th St", "Brandon", "MB", "R7A 5C5", 49.8217998, -99.9635167, "America/Winnipeg"),
  landmarkTheatre("180", "caledon-bolton", "Caledon, Bolton", "194 McEwan Drive East", "Caledon", "ON", "L7E 4E5", 43.8636615, -79.7078737, "America/Toronto"),
  landmarkTheatre("184", "calgary-country-hills", "Calgary Country Hills", "300-388 Country Hills Blvd NE", "Calgary", "AB", "T3K 5J6", 51.1559321, -114.0678131, "America/Edmonton"),
  landmarkTheatre("7800", "calgary-market-mall", "Calgary Market Mall", "3412 49th Street NW", "Calgary", "AB", "T3A 2Y9", 51.0825147, -114.157468, "America/Edmonton"),
  landmarkTheatre("196", "calgary-shawnessy", "Calgary Shawnessy", "100-16061 MacLeod Trail SE", "Calgary", "AB", "T2Y 3S5", 50.9082888, -114.0671716, "America/Edmonton"),
  landmarkTheatre("203", "courtenay", "Courtenay", "2655 Cliffe Avenue", "Courtenay", "BC", "V9N 2L8", 49.6747916, -124.9858327, "America/Vancouver"),
  landmarkTheatre("204", "cranbrook", "Cranbrook", "1500 Cranbrook Street North", "Cranbrook", "BC", "V1C 3S8", 49.5249505, -115.7524329, "America/Edmonton"),
  landmarkTheatre("206", "drayton-valley", "Drayton Valley", "5014 56 Avenue", "Drayton Valley", "AB", "T7A 1V7", 53.2276644, -114.9785249, "America/Edmonton"),
  landmarkTheatre("182", "edmonton-city-centre", "Edmonton City Centre", "10200 102 Avenue NW", "Edmonton", "AB", "T5J 4B7", 53.5436658, -113.495028, "America/Edmonton"),
  landmarkTheatre("7782", "edson", "Edson", "316 50th Street", "Edson", "AB", "T7E 1V6", 53.5827359, -116.4322213, "America/Edmonton"),
  landmarkTheatre("7799", "fort-mcmurray-eagle-ridge", "Fort McMurray Eagle Ridge", "175 Eagle Ridge Blvd", "Fort McMurray", "AB", "T9K 2Z7", 56.7534686, -111.4327053, "America/Edmonton"),
  landmarkTheatre("209", "fort-st-john", "Fort St. John", "Unit 2000, 9600 93rd Avenue", "Fort St. John", "BC", "V1J 5Z2", 56.238562, -120.8427177, "America/Fort_Nelson"),
  landmarkTheatre("188", "hamilton-jackson-square", "Hamilton, Jackson Square", "2 King Street West", "Hamilton", "ON", "L8P 1A1", 43.2579648, -79.8720291, "America/Toronto"),
  landmarkTheatre("189", "kanata", "Kanata", "801 Kanata Avenue", "Kanata", "ON", "K2T 1E7", 45.3094714, -75.9090276, "America/Toronto"),
  landmarkTheatre("211", "kelowna-grand-10", "Kelowna, Grand 10", "110-948 McCurdy Road", "Kelowna", "BC", "V1X 2P7", 49.9015312, -119.4061602, "America/Vancouver"),
  landmarkTheatre("190", "kingston", "Kingston", "120 Dalton Avenue", "Kingston", "ON", "K7K 0C3", 44.2653233, -76.5037106, "America/Toronto"),
  landmarkTheatre("192", "london", "London", "983 Wellington Road South", "London", "ON", "N6E 3A9", 42.9393477, -81.2261521, "America/Toronto"),
  landmarkTheatre("213", "nanaimo", "Nanaimo", "Woodgrove Shopping Centre, 6631 North Island Highway", "Nanaimo", "BC", "V9T 4T7", 49.2358487, -124.051108, "America/Vancouver"),
  landmarkTheatre("214", "new-westminster", "New Westminster", "New Westminster SkyTrain Station, SkyTrain Level", "New Westminster", "BC", "V3M 1G2", 49.2005677, -122.913646, "America/Vancouver"),
  landmarkTheatre("193", "orleans", "Orleans", "3752 Innes Road", "Orleans", "ON", "K1W 0C8", 45.448239, -75.5156419, "America/Toronto"),
  landmarkTheatre("195", "penticton", "Penticton", "250 Winnipeg Street", "Penticton", "BC", "V2A 5M3", 49.4989645, -119.595099, "America/Vancouver"),
  landmarkTheatre("7796", "regina", "Regina", "2064 Aurora Boulevard", "Regina", "SK", "S4V 3T7", 50.4454566, -104.514439, "America/Regina"),
  landmarkTheatre("7798", "saskatoon", "Saskatoon", "157 Gibson Bend", "Saskatoon", "SK", "S7V 0P1", 52.1337338, -106.5552215, "America/Regina"),
  landmarkTheatre("197", "spruce-grove", "Spruce Grove", "130 Century Crossing", "Spruce Grove", "AB", "T7X 0C8", 53.543822, -113.8823076, "America/Edmonton"),
  landmarkTheatre("7795", "st-albert", "St. Albert", "800 St. Albert Trail", "St. Albert", "AB", "T8N 7V2", 53.6632299, -113.6371298, "America/Edmonton"),
  landmarkTheatre("194", "st-catharines-pen-centre", "St. Catharines, Pen Centre", "221 Glendale Avenue", "St. Catharines", "ON", "L2T 2K9", 43.1380162, -79.2257714, "America/Toronto"),
  landmarkTheatre("187", "surrey-guildford", "Surrey, Guildford", "15051 101 Avenue", "Surrey", "BC", "V3R 7Z1", 49.1865658, -122.8044423, "America/Vancouver"),
  landmarkTheatre("217", "sylvan-lake", "Sylvan Lake", "9 Beju Industrial Drive", "Sylvan Lake", "AB", "T4S 2J4", 52.3099613, -114.071635, "America/Edmonton"),
  landmarkTheatre("7801", "tamarack-edmonton", "Edmonton Tamarack", "955 Tamarack Way NW", "Edmonton", "AB", "T6T 0X2", 53.4810666, -113.3652402, "America/Edmonton"),
  landmarkTheatre("200", "waterloo", "Waterloo", "415 The Boardwalk", "Waterloo", "ON", "N2T 0A6", 43.4388628, -80.5666639, "America/Toronto"),
  landmarkTheatre("207", "west-kelowna-xtreme", "West Kelowna, Xtreme", "525 Highway 97 South", "West Kelowna", "BC", "V1Z 4C9", 49.8582174, -119.5927007, "America/Vancouver"),
  landmarkTheatre("201", "whitby", "Whitby", "75 Consumers Drive", "Whitby", "ON", "L1N 9S2", 43.8692492, -78.9140134, "America/Toronto"),
  landmarkTheatre("7802", "windsor", "Windsor", "4611 Walker Road", "Windsor", "ON", "N8W 5S6", 42.2514498, -82.9642408, "America/Toronto"),
  landmarkTheatre("202", "winkler", "Winkler", "777 Norquay Drive", "Winkler", "MB", "R6W 2S2", 49.1903949, -97.9323758, "America/Winnipeg"),
  landmarkTheatre("186", "winnipeg-grant-park", "Winnipeg, Grant Park", "1120 Grant Avenue", "Winnipeg", "MB", "R3M 2A6", 49.8571642, -97.1653173, "America/Winnipeg"),
];

const LANDMARK_THEATRES_BY_ID = new Map(
  LANDMARK_THEATRES.map((theatre) => [theatre.providerTheatreId, theatre]),
);

export function getLandmarkTheatre(
  providerTheatreId: string,
): LandmarkTheatre | undefined {
  return LANDMARK_THEATRES_BY_ID.get(providerTheatreId);
}

function landmarkTheatre(
  providerTheatreId: string,
  slug: string,
  name: string,
  address: string,
  city: string,
  province: string,
  postalCode: string,
  latitude: number,
  longitude: number,
  timeZone: string,
): LandmarkTheatre {
  return {
    id: `landmark-${providerTheatreId}`,
    provider: "landmark",
    providerTheatreId,
    slug,
    name,
    address,
    city,
    province,
    postalCode,
    latitude,
    longitude,
    timeZone,
  };
}
