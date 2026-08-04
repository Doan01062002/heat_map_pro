/**
 * routes.js — Pre-defined route data for the driver simulator.
 *
 * These routes are based on real streets in Ho Chi Minh City (District 1, 3, 7).
 * Each route is an array of waypoints that a simulated driver follows.
 *
 * In a full implementation, routes would be fetched from OSRM's /route API.
 * For the demo, we use hardcoded routes to avoid external dependencies.
 */

/**
 * Route 1: District 1 — Nguyen Hue to Ben Thanh Market
 */
export const ROUTE_DISTRICT_1 = [
  { latitude: 10.7743, longitude: 106.7029 },
  { latitude: 10.7738, longitude: 106.7035 },
  { latitude: 10.7731, longitude: 106.7042 },
  { latitude: 10.7724, longitude: 106.7048 },
  { latitude: 10.7718, longitude: 106.7055 },
  { latitude: 10.7711, longitude: 106.7061 },
  { latitude: 10.7704, longitude: 106.7068 },
  { latitude: 10.7698, longitude: 106.7075 },
  { latitude: 10.7691, longitude: 106.7011 },
  { latitude: 10.7685, longitude: 106.7004 },
];

/**
 * Route 2: District 7 — Phu My Hung area
 */
export const ROUTE_DISTRICT_7 = [
  { latitude: 10.7286, longitude: 106.7174 },
  { latitude: 10.7293, longitude: 106.7182 },
  { latitude: 10.7300, longitude: 106.7191 },
  { latitude: 10.7308, longitude: 106.7199 },
  { latitude: 10.7315, longitude: 106.7208 },
  { latitude: 10.7323, longitude: 106.7216 },
  { latitude: 10.7330, longitude: 106.7225 },
  { latitude: 10.7338, longitude: 106.7233 },
  { latitude: 10.7345, longitude: 106.7242 },
  { latitude: 10.7353, longitude: 106.7250 },
];

/**
 * Route 3: District 3 — Vo Van Tan street
 */
export const ROUTE_DISTRICT_3 = [
  { latitude: 10.7800, longitude: 106.6900 },
  { latitude: 10.7793, longitude: 106.6912 },
  { latitude: 10.7786, longitude: 106.6924 },
  { latitude: 10.7779, longitude: 106.6936 },
  { latitude: 10.7772, longitude: 106.6948 },
  { latitude: 10.7765, longitude: 106.6960 },
  { latitude: 10.7758, longitude: 106.6972 },
  { latitude: 10.7751, longitude: 106.6984 },
  { latitude: 10.7744, longitude: 106.6996 },
  { latitude: 10.7737, longitude: 106.7008 },
];

/**
 * All available routes for the simulator.
 * Drivers are assigned routes in round-robin fashion.
 */
export const ALL_ROUTES = [
  ROUTE_DISTRICT_1,
  ROUTE_DISTRICT_7,
  ROUTE_DISTRICT_3,
];
