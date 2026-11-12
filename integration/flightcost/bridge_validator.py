"""Validate Aircraft Designer payload before inserting into FlightCost guest workspace.

This module deliberately does NOT write to user.db or invent a FlightCost API.
Wire the validated result to the existing workspace persistence after reviewing
its current handler and CSRF scheme. This function is server-side and stdlib only.
"""
from __future__ import annotations

import math
from typing import Any

SCHEMA = 'aircraft-designer/flightcost-design'


def validate_design(data: Any, *, expected_icao: str | None = None, expected_engine: str | None = None) -> dict:
    if not isinstance(data, dict) or data.get('protocol') != SCHEMA or type(data.get('version')) is not int or data['version'] != 1:
        raise ValueError('Unsupported design protocol/version')
    ac, weights = data.get('aircraft'), data.get('weights')
    if not isinstance(ac, dict) or not isinstance(weights, dict):
        raise ValueError('Missing aircraft/weights')
    icao, engine = ac.get('icao'), ac.get('engine')
    if not isinstance(icao, str) or not (2 <= len(icao) <= 5 and icao.isupper() and icao.isalnum()):
        raise ValueError('Invalid ICAO type')
    if not isinstance(engine, str) or not engine or len(engine) > 64:
        raise ValueError('Invalid engine')
    if expected_icao and icao != expected_icao:
        raise ValueError('Wrong ICAO type')
    if expected_engine and engine != expected_engine:
        raise ValueError('Wrong engine variant')
    zones = ac.get('cabin')
    if not isinstance(zones, list) or not (1 <= len(zones) <= 100):
        raise ValueError('Invalid cabin zones')
    seats = 0
    for z in zones:
        if not isinstance(z, dict):
            raise ValueError('Invalid cabin zone')
        if z.get('class') not in ('economy', 'business', 'premium'):
            raise ValueError('Invalid cabin class')
        rows, abreast = z.get('rows'), z.get('seatsPerRow')
        last = z.get('lastRowSeats', abreast)
        pitch = z.get('pitchM')
        if not all(isinstance(x, int) and not isinstance(x, bool) for x in (rows, abreast, last)):
            raise ValueError('Seat positions must be integers')
        if not (1 <= rows <= 100 and 2 <= abreast <= 10 and 1 <= last <= abreast and
                isinstance(pitch, (int, float)) and not isinstance(pitch, bool) and math.isfinite(pitch) and 0.65 <= pitch <= 1.5):
            raise ValueError('Cabin row out of bounds')
        seats += (rows-1) * abreast + last
    if type(ac.get('seats')) is not int or seats != ac['seats'] or not 1 <= seats <= 400:
        raise ValueError('Seat count differs from cabin zones')
    w = {}
    for k in ('oew_kg', 'mtow_kg', 'mzfw_kg', 'mlw_kg', 'fuel_capacity_kg'):
        v = weights.get(k)
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or not 0 <= v <= 1_000_000:
            raise ValueError(f'Invalid {k}')
        w[k] = float(v)
    if not (1000 <= w['oew_kg'] < w['mzfw_kg'] <= w['mtow_kg'] and
            w['oew_kg'] < w['mlw_kg'] <= w['mtow_kg'] and
            w['fuel_capacity_kg'] <= w['mtow_kg']):
        raise ValueError('Mass limits are inconsistent')
    # No trip fuel in this protocol: FlightCost must use its own documented burn tier.
    return data
