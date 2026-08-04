/**
 * protobuf.js — Protobuf encoding/decoding helpers for the simulator.
 *
 * Uses protobufjs to load the .proto schema and encode/decode messages.
 * The .proto file is the single source of truth (shared with Go backend).
 *
 * Usage:
 *   import { encodeGPSBatch } from '../lib/protobuf';
 *   const buffer = await encodeGPSBatch(points);
 *   ws.send(buffer);
 */
import protobuf from 'protobufjs';

let GPSBatchType = null;
let GPSPointType = null;

/**
 * Load the Protobuf schema. Call this once at app startup.
 * The .proto file path is relative to the public/ directory.
 */
export async function loadProtoSchema() {
  // In production, the .proto file should be served as a static asset.
  // For development, we can load it directly.
  const root = await protobuf.load('/proto/heatmap/v1/messages.proto');
  GPSBatchType = root.lookupType('heatmap.v1.GPSBatch');
  GPSPointType = root.lookupType('heatmap.v1.GPSPoint');
}

/**
 * Encode an array of GPS point objects into a Protobuf binary buffer.
 *
 * @param {Array<{driver_id: string, trip_id: string, latitude: number, longitude: number, timestamp: number, heading: number, speed: number}>} points
 * @returns {Uint8Array} Protobuf-encoded GPSBatch binary
 */
export function encodeGPSBatch(points) {
  if (!GPSBatchType) {
    throw new Error('Protobuf schema not loaded. Call loadProtoSchema() first.');
  }

  const message = GPSBatchType.create({
    points: points.map((p) => ({
      driverId: p.driver_id,
      tripId: p.trip_id,
      latitude: p.latitude,
      longitude: p.longitude,
      timestamp: p.timestamp,
      heading: p.heading,
      speed: p.speed,
    })),
  });

  return GPSBatchType.encode(message).finish();
}

/**
 * Decode a Protobuf binary buffer into a GPSBatch object.
 *
 * @param {Uint8Array} buffer
 * @returns {{ points: Array }}
 */
export function decodeGPSBatch(buffer) {
  if (!GPSBatchType) {
    throw new Error('Protobuf schema not loaded. Call loadProtoSchema() first.');
  }

  return GPSBatchType.decode(buffer);
}
