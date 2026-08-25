import * as turf from '@turf/turf';

// 1. حساب المسافة (معادلة Haversine سليمة رياضياً)
export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // نصف قطر الأرض بالكيلومتر
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// 2. التحقق من وقوع الإحداثيات داخل النطاق
export const isLocationInZone = (
    lat: number,
    lng: number,
    zoneId: string | null | undefined,
    fee: any
): boolean => {
    if (!fee || typeof lat !== 'number' || typeof lng !== 'number') return false;

    const userPoint = turf.point([lng, lat]);

    // 🔴 RADIUS
    if (fee.coverageType === "RADIUS") {
        let coords: any = fee.customCoordinates || fee.defaultCoordinates;
        if (typeof coords === "string") {
            try { coords = JSON.parse(coords); } catch (e) { return false; }
        }

        const center = Array.isArray(coords) ? coords[0] : coords;
        const radiusKm = parseFloat((fee.customRadiusKm || fee.defaultRadiusKm || "0") as string);

        // دعم الإحداثيات سواء كانت Object {lat, lng} أو Array [lng, lat] / [lat, lng]
        let centerLat: number | null = null;
        let centerLng: number | null = null;

        if (center && typeof center === 'object') {
            if ('lat' in center && 'lng' in center) {
                centerLat = parseFloat(center.lat);
                centerLng = parseFloat(center.lng);
            } else if (Array.isArray(center) && center.length >= 2) {
                // افتراض أن Array التنسيق هو [lng, lat] الخاص بـ GeoJSON
                centerLng = parseFloat(center[0]);
                centerLat = parseFloat(center[1]);
            }
        }

        if (centerLat !== null && centerLng !== null && !isNaN(centerLat) && !isNaN(centerLng) && radiusKm > 0) {
            const centerPoint = turf.point([centerLng, centerLat]);
            const distanceKm = turf.distance(userPoint, centerPoint, { units: "kilometers" });
            return distanceKm <= radiusKm;
        }
    }

    // 🟢 POLYGON
    else if (fee.coverageType === "POLYGON") {
        let polyCoordinates = fee.customCoordinates || fee.defaultCoordinates;

        if (typeof polyCoordinates === "string") {
            try { polyCoordinates = JSON.parse(polyCoordinates); } catch (e) { return false; }
        }

        if (polyCoordinates) {
            try {
                let rawCoords: any = polyCoordinates;

                // استخراج الـ Coordinates حسب بنية GeoJSON
                if (polyCoordinates.type === "FeatureCollection") {
                    rawCoords = polyCoordinates.features?.[0]?.geometry?.coordinates;
                } else if (polyCoordinates.type === "Feature") {
                    rawCoords = polyCoordinates.geometry?.coordinates;
                } else if (polyCoordinates.type === "Polygon") {
                    rawCoords = polyCoordinates.coordinates;
                }

                if (Array.isArray(rawCoords) && rawCoords.length > 0) {
                    // تحديد الـ ring: إذا كانت مصفوفة متداخلة نأخذ المستوى الداخلي، وإلا نستخدم المصفوفة نفسها
                    let ring = rawCoords;
                    if (Array.isArray(rawCoords[0]) && Array.isArray(rawCoords[0][0])) {
                        // [[[lng, lat], ...]] (GeoJSON Polygon standard)
                        ring = rawCoords[0];
                    } else if (Array.isArray(rawCoords[0]) && typeof rawCoords[0][0] === "object" && rawCoords[0][0] !== null) {
                        // [[{lat, lng}, ...]]
                        ring = rawCoords[0];
                    }

                    // تحويل الإحداثيات إلى صيغة Turf المطلوبة: [[lng, lat]]
                    let formattedRing: [number, number][] = ring
                        .map((pt: any) => {
                            if (Array.isArray(pt)) {
                                return [parseFloat(pt[0]), parseFloat(pt[1])] as [number, number];
                            }
                            if (pt && typeof pt === "object" && pt.lng !== undefined && pt.lat !== undefined) {
                                return [parseFloat(pt.lng), parseFloat(pt.lat)] as [number, number];
                            }
                            return null;
                        })
                        .filter((pt): pt is [number, number] => pt !== null && !isNaN(pt[0]) && !isNaN(pt[1]));

                    if (formattedRing.length < 3) return false;

                    // تأكيد إغلاق الحلقة (First point === Last point)
                    const firstPt = formattedRing[0];
                    const lastPt = formattedRing[formattedRing.length - 1];
                    if (firstPt[0] !== lastPt[0] || firstPt[1] !== lastPt[1]) {
                        formattedRing.push(firstPt);
                    }

                    if (formattedRing.length < 4) return false;

                    const polygon = turf.polygon([formattedRing]);
                    return turf.booleanPointInPolygon(userPoint, polygon);
                }
            } catch (err) {
                console.error("Error evaluating polygon geometry:", err);
            }
        }
    }

    // 🟡 Fallback
    else if (zoneId && fee.zoneId) {
        return zoneId === fee.zoneId;
    }

    return false;
};






// export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
//     const R = 6371; // نصف قطر الأرض بالكيلومتر
//     const dLat = (lat2 - lat1) * Math.PI / 180;
//     const dLon = (lon2 - lon1) * Math.PI / 180;
    
//     const a = 
//         Math.sin(dLat / 2) * Math.sin(dLat / 2) +
//         Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        
//     const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
//     return R * c; // المسافة بالكيلومتر
// };

// import * as turf from '@turf/turf';

// export const isLocationInZone = (
//     lat: number,
//     lng: number,
//     zoneId: string | null | undefined,
//     fee: any
// ): boolean => {
//     let matchesZone = false;
//     const userPoint = turf.point([lng, lat]);

//     // 🔴 النوع الأول: RADIUS (دائرة وحساب مسافة)
//     if (fee.coverageType === "RADIUS") {
//         let coords: any = fee.customCoordinates || fee.defaultCoordinates;
//         if (typeof coords === "string") {
//             try { coords = JSON.parse(coords); } catch (e) {}
//         }
//         const center = Array.isArray(coords) ? coords[0] : coords;
//         const radiusKm = parseFloat((fee.customRadiusKm || fee.defaultRadiusKm || "0") as string);

//         if (center?.lat && center?.lng && radiusKm > 0) {
//             const centerPoint = turf.point([parseFloat(center.lng), parseFloat(center.lat)]);
//             const distanceKm = turf.distance(userPoint, centerPoint, { units: "kilometers" });

//             if (distanceKm <= radiusKm) {
//                 matchesZone = true;
//             }
//         }
//     } 
//     // 🟢 النوع الثاني: POLYGON (رسم مضلع جغرافي)
//     else if (fee.coverageType === "POLYGON") {
//         let polyCoordinates = fee.customCoordinates || fee.defaultCoordinates;
        
//         if (typeof polyCoordinates === "string") {
//             try { polyCoordinates = JSON.parse(polyCoordinates); } catch (e) {}
//         }

//         if (polyCoordinates) {
//             try {
//                 let polygonGeometry: any = polyCoordinates;

//                 // التعامل مع أشكال GeoJSON المختلفة (FeatureCollection أو Feature أو Raw Array)
//                 const polyData: any = polyCoordinates;
//                 if (polyData.type === "FeatureCollection") {
//                     polygonGeometry = polyData.features[0].geometry;
//                 } else if (polyData.type === "Feature") {
//                     polygonGeometry = polyData.geometry;
//                 }

//                 // إنشاء Polygon وتأكيد هل نقطة العنوان بداخله
//                 if (polygonGeometry?.coordinates) {
//                     const polygon = turf.polygon(polygonGeometry.coordinates);
//                     if (turf.booleanPointInPolygon(userPoint, polygon)) {
//                         matchesZone = true;
//                     }
//                 }
//             } catch (err) {
//                 console.error("Error parsing polygon geometry:", err);
//             }
//         }
//     }
//     // 🟡 Fallback عادي (لو الـ Coverage نوع تاني أو يعتمد فقط على Zone ID)
//     else {
//         if (zoneId && zoneId === fee.zoneId) {
//             matchesZone = true;
//         }
//     }

//     return matchesZone;
// };