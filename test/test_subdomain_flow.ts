/**
 * Automated test script for Subdomain ('subdomain' source) flow.
 * Target: https://keetobcknd.keeto.org (or TEST_BASE_URL)
 *
 * Runs with:
 *   npx tsx test_subdomain_flow.ts
 */

import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

const BASE_URL = process.env.TEST_BASE_URL || process.env.BASE_URL || "https://keetobcknd.keeto.org";
const RESTAURANT_ID = process.env.TEST_RESTAURANT_ID || "72acb976-7218-44b9-be01-36bdf321d1f3";
const JWT_SECRET = process.env.JWT_SECRET || "1c11b41e35f9059f42993c7d9317c14fdaa6a84ca8d01390f0ceb507946b650336bb55bbd97e18f715fc702e01d9debd94d977b4fedc6d7827e0be84318a07b8";

function getAdminToken(): string {
  if (process.env.ADMIN_TOKEN) {
    return process.env.ADMIN_TOKEN;
  }
  const payload = {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Super Admin Tester",
    role: "superadmin",
    type: "super_admin",
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "2h" });
}

const TOKEN = getAdminToken();
const headersWithAuth = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${TOKEN}`,
};

const uniqueSuffix = Date.now().toString(36).slice(-4);
const TEST_LABEL = `tst${uniqueSuffix}`;

interface StepResult {
  step: string;
  success: boolean;
  message: string;
  data?: any;
}

const results: StepResult[] = [];

function logStep(title: string) {
  console.log(`\n============================================================`);
  console.log(`🔹 ${title}`);
  console.log(`============================================================`);
}

async function request(url: string, options: RequestInit = {}): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body };
  } catch (err: any) {
    return { status: 0, body: { error: err?.message || "Connection failed" } };
  }
}

async function run() {
  console.log(`🚀 Starting Subdomain Source Flow Test`);
  console.log(`📍 Target Server: ${BASE_URL}`);
  console.log(`📍 Restaurant ID: ${RESTAURANT_ID}`);
  console.log(`📍 Test Label:    ${TEST_LABEL}`);

  let adminPrefix = "/api/superadmin";
  const probe = await request(`${BASE_URL}/api/admin/restaurants/${RESTAURANT_ID}/domains`, {
    headers: headersWithAuth,
  });
  if (probe.status !== 404) {
    adminPrefix = "/api/admin";
  }
  console.log(`📍 Admin Prefix:  ${adminPrefix}`);

  // STEP 1: Format validation - Invalid label
  logStep("TEST 1: Check Subdomain Availability - INVALID format (short / invalid chars)");
  const invRes = await request(`${BASE_URL}${adminPrefix}/domains/check-subdomain?label=ab`, {
    headers: headersWithAuth,
  });
  console.log(`Status: ${invRes.status}, Body:`, invRes.body);
  const isInvalidSuccess = invRes.status === 200 && invRes.body?.available === false && invRes.body?.reason === "invalid";
  results.push({
    step: "1. Availability: Invalid Label",
    success: isInvalidSuccess,
    message: isInvalidSuccess ? "Correctly flagged 'ab' as invalid" : `Unexpected response: ${JSON.stringify(invRes.body)}`,
  });

  // STEP 2: Reserved check
  logStep("TEST 2: Check Subdomain Availability - RESERVED keyword ('api')");
  const resRes = await request(`${BASE_URL}${adminPrefix}/domains/check-subdomain?label=api`, {
    headers: headersWithAuth,
  });
  console.log(`Status: ${resRes.status}, Body:`, resRes.body);
  const isReservedSuccess = resRes.status === 200 && resRes.body?.available === false && resRes.body?.reason === "reserved";
  results.push({
    step: "2. Availability: Reserved Label",
    success: isReservedSuccess,
    message: isReservedSuccess ? "Correctly flagged 'api' as reserved" : `Unexpected response: ${JSON.stringify(resRes.body)}`,
  });

  // STEP 3: Available check
  logStep(`TEST 3: Check Subdomain Availability - AVAILABLE label ('${TEST_LABEL}')`);
  const availRes = await request(`${BASE_URL}${adminPrefix}/domains/check-subdomain?label=${TEST_LABEL}`, {
    headers: headersWithAuth,
  });
  console.log(`Status: ${availRes.status}, Body:`, availRes.body);
  const isAvailSuccess = availRes.status === 200 && availRes.body?.available === true;
  results.push({
    step: "3. Availability: Valid New Label",
    success: isAvailSuccess,
    message: isAvailSuccess ? `Label '${TEST_LABEL}' is available (${availRes.body?.domain})` : `Check failed: ${JSON.stringify(availRes.body)}`,
  });

  let createdDomainId: number | null = null;
  let fullDomain: string = `${TEST_LABEL}.keeto.org`;

  // STEP 4: Add domain with source='subdomain'
  logStep(`TEST 4: POST ${adminPrefix}/restaurants/${RESTAURANT_ID}/domains (source: subdomain)`);
  const addRes = await request(`${BASE_URL}${adminPrefix}/restaurants/${RESTAURANT_ID}/domains`, {
    method: "POST",
    headers: headersWithAuth,
    body: JSON.stringify({
      source: "subdomain",
      label: TEST_LABEL,
    }),
  });

  console.log(`Status: ${addRes.status}`);
  console.log(`Response:`, JSON.stringify(addRes.body, null, 2));

  if (addRes.status === 201 && addRes.body?.id) {
    createdDomainId = addRes.body.id;
    fullDomain = addRes.body.domain;
    const isSub = addRes.body.source === "subdomain";
    const isVer = addRes.body.verified === true || addRes.body.verified === 1;
    const hasDnsStatus = !!addRes.body.dns_status;

    results.push({
      step: "4. Create Subdomain",
      success: isSub && isVer && hasDnsStatus,
      message: `Created ID=${createdDomainId}, domain=${fullDomain}, verified=${isVer}, dns_status=${addRes.body.dns_status}`,
      data: addRes.body,
    });
  } else {
    results.push({
      step: "4. Create Subdomain",
      success: false,
      message: `Failed: Status ${addRes.status}, Body: ${JSON.stringify(addRes.body)}`,
    });
    printSummary();
    return;
  }

  // STEP 5: Duplicate check - Expect 409
  logStep(`TEST 5: Duplicate POST - Expect 409 (reason: 'taken')`);
  const dupRes = await request(`${BASE_URL}${adminPrefix}/restaurants/${RESTAURANT_ID}/domains`, {
    method: "POST",
    headers: headersWithAuth,
    body: JSON.stringify({
      source: "subdomain",
      label: TEST_LABEL,
    }),
  });

  console.log(`Status: ${dupRes.status}`);
  console.log(`Response:`, JSON.stringify(dupRes.body, null, 2));
  const isDupSuccess = dupRes.status === 409 && (dupRes.body?.reason === "taken" || JSON.stringify(dupRes.body).toLowerCase().includes("already registered"));
  results.push({
    step: "5. Duplicate Protection",
    success: isDupSuccess,
    message: isDupSuccess ? "Duplicate registration rejected with 409" : `Unexpected response: ${dupRes.status}`,
  });

  // STEP 6: List domains - verify dnsStatus is returned
  logStep(`TEST 6: GET ${adminPrefix}/restaurants/${RESTAURANT_ID}/domains (verify dnsStatus)`);
  const listRes = await request(`${BASE_URL}${adminPrefix}/restaurants/${RESTAURANT_ID}/domains`, {
    headers: headersWithAuth,
  });

  const domainsList: any[] = Array.isArray(listRes.body?.data) ? listRes.body.data : Array.isArray(listRes.body) ? listRes.body : [];
  const foundDomain = domainsList.find((d) => d.id === createdDomainId);
  console.log(`Found domain in list:`, foundDomain);
  const isListSuccess = listRes.status === 200 && foundDomain && foundDomain.dnsStatus !== undefined;
  results.push({
    step: "6. List Domains with dnsStatus",
    success: !!isListSuccess,
    message: isListSuccess ? `Domain present in list with dnsStatus='${foundDomain.dnsStatus}'` : "Domain missing or dnsStatus undefined",
  });

  // STEP 7: Resolve Domain Publicly
  logStep(`TEST 7: GET /api/resolve-domain?host=${fullDomain}`);
  const resolveRes = await request(`${BASE_URL}/api/resolve-domain?host=${fullDomain}`);
  console.log(`Status: ${resolveRes.status}, Body:`, resolveRes.body);
  const isResolveSuccess = resolveRes.status === 200 && !!resolveRes.body?.restaurantSlug;
  results.push({
    step: "7. Public Resolve Domain",
    success: isResolveSuccess,
    message: isResolveSuccess ? `Successfully resolved ${fullDomain} -> slug: '${resolveRes.body?.restaurantSlug}'` : `Failed to resolve: ${JSON.stringify(resolveRes.body)}`,
  });

  // STEP 8: Delete Subdomain - verify note returned for manual DNS removal
  logStep(`TEST 8: DELETE ${adminPrefix}/domains/${createdDomainId} (verify DNS removal note)`);
  const delRes = await request(`${BASE_URL}${adminPrefix}/domains/${createdDomainId}`, {
    method: "DELETE",
    headers: headersWithAuth,
  });
  console.log(`Status: ${delRes.status}, Body:`, delRes.body);
  const dataObj = delRes.body?.data || delRes.body;
  const hasNote = !!dataObj?.note && dataObj?.deleted === true;
  results.push({
    step: "8. Delete Subdomain",
    success: delRes.status === 200 && hasNote,
    message: hasNote ? `Deleted with admin note: '${dataObj.note}'` : `Delete response missing note: ${JSON.stringify(delRes.body)}`,
  });

  // STEP 9: 404 after deletion
  logStep(`TEST 9: GET /api/resolve-domain?host=${fullDomain} (Expect 404)`);
  const postDelResolve = await request(`${BASE_URL}/api/resolve-domain?host=${fullDomain}`);
  console.log(`Status: ${postDelResolve.status}, Body:`, postDelResolve.body);
  const is404Success = postDelResolve.status === 404;
  results.push({
    step: "9. Cache Eviction / 404 After Delete",
    success: is404Success,
    message: is404Success ? `Domain correctly returned 404 after deletion` : `Unexpected status: ${postDelResolve.status}`,
  });

  printSummary();
}

function printSummary() {
  console.log(`\n============================================================`);
  console.log(`📋 SUBDOMAIN FEATURE TEST SUMMARY`);
  console.log(`============================================================`);
  let allPassed = true;
  for (const r of results) {
    const icon = r.success ? "✅ PASS" : "❌ FAIL";
    if (!r.success) allPassed = false;
    console.log(`${icon} | ${r.step}`);
    console.log(`       ↳ ${r.message}`);
  }
  console.log(`============================================================`);
  if (allPassed) {
    console.log(`🎉 ALL TESTS PASSED! Subdomain feature is completely functional.`);
  } else {
    console.log(`⚠️ Some tests did not pass. Check the details above.`);
  }
  console.log(`============================================================\n`);
}

run().catch((err) => {
  console.error("Fatal test error:", err);
});
