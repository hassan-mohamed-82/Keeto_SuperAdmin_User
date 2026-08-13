
export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // نصف قطر الأرض بالكيلومتر
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // المسافة بالكيلومتر
};

import * as turf from '@turf/turf';

export const isLocationInZone = (
    lat: number,
    lng: number,
    zoneId: string | null | undefined,
    fee: any
): boolean => {
    let matchesZone = false;
    const userPoint = turf.point([lng, lat]);

    // 🔴 النوع الأول: RADIUS (دائرة وحساب مسافة)
    if (fee.coverageType === "RADIUS") {
        let coords: any = fee.customCoordinates || fee.defaultCoordinates;
        if (typeof coords === "string") {
            try { coords = JSON.parse(coords); } catch (e) {}
        }
        const center = Array.isArray(coords) ? coords[0] : coords;
        const radiusKm = parseFloat((fee.customRadiusKm || fee.defaultRadiusKm || "0") as string);

        if (center?.lat && center?.lng && radiusKm > 0) {
            const centerPoint = turf.point([parseFloat(center.lng), parseFloat(center.lat)]);
            const distanceKm = turf.distance(userPoint, centerPoint, { units: "kilometers" });

            if (distanceKm <= radiusKm) {
                matchesZone = true;
            }
        }
    } 
    // 🟢 النوع الثاني: POLYGON (رسم مضلع جغرافي)
    else if (fee.coverageType === "POLYGON") {
        let polyCoordinates = fee.customCoordinates || fee.defaultCoordinates;
        
        if (typeof polyCoordinates === "string") {
            try { polyCoordinates = JSON.parse(polyCoordinates); } catch (e) {}
        }

        if (polyCoordinates) {
            try {
                let polygonGeometry: any = polyCoordinates;

                // التعامل مع أشكال GeoJSON المختلفة (FeatureCollection أو Feature أو Raw Array)
                const polyData: any = polyCoordinates;
                if (polyData.type === "FeatureCollection") {
                    polygonGeometry = polyData.features[0].geometry;
                } else if (polyData.type === "Feature") {
                    polygonGeometry = polyData.geometry;
                }

                // إنشاء Polygon وتأكيد هل نقطة العنوان بداخله
                if (polygonGeometry?.coordinates) {
                    const polygon = turf.polygon(polygonGeometry.coordinates);
                    if (turf.booleanPointInPolygon(userPoint, polygon)) {
                        matchesZone = true;
                    }
                }
            } catch (err) {
                console.error("Error parsing polygon geometry:", err);
            }
        }
    }
    // 🟡 Fallback عادي (لو الـ Coverage نوع تاني أو يعتمد فقط على Zone ID)
    else {
        if (zoneId && zoneId === fee.zoneId) {
            matchesZone = true;
        }
    }

    return matchesZone;
};