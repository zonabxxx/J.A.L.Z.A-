"use client";

export interface UserLocation {
  city: string;
  country: string;
  lat: number;
  lon: number;
}

let locationPromise: Promise<UserLocation | null> | null = null;

export function getLocationSync(): UserLocation | null {
  const stored = localStorage.getItem("jalza_location");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  return null;
}

export async function getLocation(): Promise<UserLocation | null> {
  const sync = getLocationSync();
  if (sync) return sync;
  return null;
}

export function initLocationOnStartup(): void {
  const existing = getLocationSync();
  if (existing) return;
  if (locationPromise) return;
  locationPromise = requestLocation();
}

export async function requestLocation(): Promise<UserLocation | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=sk`,
            { headers: { "User-Agent": "JALZA/1.0" } }
          );
          const data = await res.json();
          const location: UserLocation = {
            city:
              data.address?.city ||
              data.address?.town ||
              data.address?.village ||
              "Unknown",
            country: data.address?.country || "Unknown",
            lat: latitude,
            lon: longitude,
          };
          localStorage.setItem("jalza_location", JSON.stringify(location));
          resolve(location);
        } catch {
          resolve(null);
        }
      },
      () => resolve(null),
      { timeout: 10000 }
    );
  });
}
