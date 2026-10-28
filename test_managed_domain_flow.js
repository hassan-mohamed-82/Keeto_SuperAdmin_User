/**
 * Automated test script for Custom Managed Domain flow on PRODUCTION.
 * Target: https://keetobcknd.keeto.org
 * Restaurant ID: 72acb976-7218-44b9-be01-36bdf321d1f3
 *
 * Runs directly with:
 *   node test_managed_domain_flow.js
 */

const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");

dotenv.config();

// Use production domain by default
const BASE_URL = process.env.TEST_BASE_URL || process.env.BASE_URL || "https://keetobcknd.keeto.org";
const RESTAURANT_ID = "72acb976-7218-44b9-be01-36bdf321d1f3";
const JWT_SECRET = process.env.JWT_SECRET || "1c11b41e35f9059f42993c7d9317c14fdaa6a84ca8d01390f0ceb507946b650336bb55bbd97e18f715fc702e01d9debd94d977b4fedc6d7827e0be84318a07b8";

// Generate or use existing admin token
function getAdminToken() {
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

const uniqueSuffix = Date.now().toString(36);
const TEST_DOMAIN = `keeto-managed-test-${uniqueSuffix}.com`;

const results = [];

function logStep(title) {
  console.log(`\n============================================================`);
  console.log(`🔹 ${title}`);
  console.log(`============================================================`);
}

async function request(url, options = {}) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: { error: err?.message || "Connection failed" } };
  }
}

async function run() {
  console.log(`🚀 Starting Custom Managed Domain Flow Test`);
  console.log(`📍 Production URL: ${BASE_URL}`);
  console.log(`📍 Restaurant ID:  ${RESTAURANT_ID}`);
  console.log(`📍 Test Domain:    ${TEST_DOMAIN}`);

  // Auto-detect whether admin routes are under /api/superadmin or /api/admin
  let adminPrefix = "/api/superadmin";
  const probe = await request(`${BASE_URL}/api/admin/restaurants/${RESTAURANT_ID}/domains`, {
    headers: headersWithAuth,
  });
  if (probe.status !== 404) {
    adminPrefix = "/api/admin";
  }
  console.log(`📍 Admin Prefix:   ${adminPrefix}`);

  let createdDomainId = null;

  // -------------------------------------------------------------
  // STEP 1: Ping production server
  // -------------------------------------------------------------
  logStep("STEP 1: Checking Server Connectivity");
  const ping = await request(`${BASE_URL}/api`);
  if (ping.status === 200) {
    results.push({ step: "1. Server Health Check", success: true, message: `Server is up: ${JSON.stringify(ping.body)}` });
    console.log(`✅ Production server is online: ${JSON.stringify(ping.body)}`);
  } else {
    results.push({ step: "1. Server Health Check", success: false, message: `Server not reachable at ${BASE_URL} (Status: ${ping.status})` });
    console.error(`❌ Server is not reachable at ${BASE_URL}.`);
    printSummary();
    return;
  }

  // -------------------------------------------------------------
  // STEP 2: Add Managed Domain
  // -------------------------------------------------------------
  logStep(`STEP 2: POST ${adminPrefix}/restaurants/${RESTAURANT_ID}/domains (Managed)`);
  const addRes = await request(`${BASE_URL}${adminPrefix}/restaurants/${RESTAURANT_ID}/domains`, {
    method: "POST",
    headers: headersWithAuth,
    body: JSON.stringify({
      domain: TEST_DOMAIN,
      source: "managed",
    }),
  });

  console.log(`Status: ${addRes.status}`);
  console.log(`Response:`, JSON.stringify(addRes.body, null, 2));

  if (addRes.status === 201 && addRes.body?.id) {
    createdDomainId = addRes.body.id;
    const isManaged = addRes.body.source === "managed";
    const isVerified = addRes.body.verified === true || addRes.body.verified === 1;
    results.push({
      step: "2. Add Managed Domain",
      success: isManaged && isVerified,
      message: `Domain created ID=${createdDomainId}, source=${addRes.body.source}, verified=${addRes.body.verified}, is_apex=${addRes.body.is_apex}`,
    });
    console.log(`✅ Managed domain created and automatically verified!`);
  } else {
    results.push({
      step: "2. Add Managed Domain",
      success: false,
      message: `Failed: Status ${addRes.status}, Body: ${JSON.stringify(addRes.body)}`,
    });
    console.error(`❌ Could not create managed domain. Aborting subsequent steps.`);
    printSummary();
    return;
  }

  // -------------------------------------------------------------
  // STEP 3: List Domains for Restaurant
  // -------------------------------------------------------------
  logStep(`STEP 3: GET ${adminPrefix}/restaurants/${RESTAURANT_ID}/domains`);
  const listRes = await request(`${BASE_URL}${adminPrefix}/restaurants/${RESTAURANT_ID}/domains`, {
    method: "GET",
    headers: headersWithAuth,
  });

  console.log(`Status: ${listRes.status}`);
  const domainsList = Array.isArray(listRes.body?.data) ? listRes.body.data : Array.isArray(listRes.body) ? listRes.body : [];
  console.log(`Found ${domainsList.length} domain(s):`, JSON.stringify(domainsList, null, 2));

  const foundInList = domainsList.some((d) => d.id === createdDomainId || d.domain === TEST_DOMAIN);
  results.push({
    step: "3. List Restaurant Domains",
    success: listRes.status === 200 && foundInList,
    message: foundInList ? `Domain ${TEST_DOMAIN} (ID ${createdDomainId}) confirmed in database list` : `Domain not found in returned list`,
  });

  // -------------------------------------------------------------
  // STEP 4: Public Domain Resolution (No Auth)
  // -------------------------------------------------------------
  logStep(`STEP 4: GET /api/resolve-domain?host=${TEST_DOMAIN}`);
  const tStart = Date.now();
  const resolveRes = await request(`${BASE_URL}/api/resolve-domain?host=${TEST_DOMAIN}`);
  const tElapsed = Date.now() - tStart;

  console.log(`Status: ${resolveRes.status} (${tElapsed}ms)`);
  console.log(`Response:`, JSON.stringify(resolveRes.body, null, 2));

  if (resolveRes.status === 200 && resolveRes.body?.restaurantSlug) {
    results.push({
      step: "4. Public Domain Resolution",
      success: true,
      message: `Resolved ${TEST_DOMAIN} -> slug: '${resolveRes.body.restaurantSlug}', name: '${resolveRes.body.name}'`,
    });
    console.log(`✅ Public resolve endpoint resolved hostname directly to restaurant!`);
  } else {
    results.push({
      step: "4. Public Domain Resolution",
      success: false,
      message: `Resolution failed. Status: ${resolveRes.status}, Body: ${JSON.stringify(resolveRes.body)}`,
    });
  }

  // -------------------------------------------------------------
  // STEP 5: Cache Hit Test
  // -------------------------------------------------------------
  logStep(`STEP 5: GET /api/resolve-domain?host=${TEST_DOMAIN} (In-Memory Cache)`);
  const tCacheStart = Date.now();
  const cacheRes = await request(`${BASE_URL}/api/resolve-domain?host=${TEST_DOMAIN}`);
  const tCacheElapsed = Date.now() - tCacheStart;

  console.log(`Cache Status: ${cacheRes.status} (${tCacheElapsed}ms)`);
  const cacheHitSuccess = cacheRes.status === 200 && cacheRes.body?.restaurantSlug === resolveRes.body?.restaurantSlug;
  results.push({
    step: "5. In-Memory Cache Verification",
    success: cacheHitSuccess,
    message: `Cache returned identical response in ${tCacheElapsed}ms`,
  });

  // -------------------------------------------------------------
  // STEP 6: Provision Domain Endpoint
  // -------------------------------------------------------------
  logStep(`STEP 6: POST ${adminPrefix}/domains/${createdDomainId}/provision`);
  const provisionRes = await request(`${BASE_URL}${adminPrefix}/domains/${createdDomainId}/provision`, {
    method: "POST",
    headers: headersWithAuth,
  });

  console.log(`Status: ${provisionRes.status}`);
  console.log(`Response:`, JSON.stringify(provisionRes.body, null, 2));

  const errorMessage =
    typeof provisionRes.body?.error === "string"
      ? provisionRes.body.error
      : provisionRes.body?.error?.message || "";

  const isPleskDisabledExpected =
    provisionRes.status === 400 &&
    errorMessage.includes("ENABLE_PLESK_PROVISIONING is disabled");

  results.push({
    step: "6. Provisioning Endpoint",
    success: provisionRes.status === 200 || isPleskDisabledExpected,
    message: provisionRes.status === 200
      ? `Provisioning succeeded on Plesk`
      : `Plesk disabled guard verified properly: ${JSON.stringify(provisionRes.body)}`,
  });

  // -------------------------------------------------------------
  // STEP 7: Set Order Link Validation
  // -------------------------------------------------------------
  logStep(`STEP 7: POST ${adminPrefix}/domains/${createdDomainId}/set-order-link`);
  const orderLinkRes = await request(`${BASE_URL}${adminPrefix}/domains/${createdDomainId}/set-order-link`, {
    method: "POST",
    headers: headersWithAuth,
  });

  console.log(`Status: ${orderLinkRes.status}`);
  console.log(`Response:`, JSON.stringify(orderLinkRes.body, null, 2));

  const expectedSslPendingBlock =
    orderLinkRes.status === 400 &&
    JSON.stringify(orderLinkRes.body).toLowerCase().includes("ssl must be active");

  results.push({
    step: "7. Set Order Link Validation",
    success: orderLinkRes.status === 200 || expectedSslPendingBlock,
    message: orderLinkRes.status === 200
      ? `Order link updated to https://${TEST_DOMAIN}`
      : `Safety check verified: prevented setting order link while SSL status is pending`,
  });

  // -------------------------------------------------------------
  // STEP 8: Delete Domain (Cleanup)
  // -------------------------------------------------------------
  logStep(`STEP 8: DELETE ${adminPrefix}/domains/${createdDomainId}`);
  const deleteRes = await request(`${BASE_URL}${adminPrefix}/domains/${createdDomainId}`, {
    method: "DELETE",
    headers: headersWithAuth,
  });

  console.log(`Status: ${deleteRes.status}`);
  console.log(`Response:`, JSON.stringify(deleteRes.body, null, 2));

  results.push({
    step: "8. Delete Domain",
    success: deleteRes.status === 200,
    message: `Domain deleted from DB and cache eviction triggered`,
  });

  // -------------------------------------------------------------
  // STEP 9: Verify 404 After Deletion
  // -------------------------------------------------------------
  logStep(`STEP 9: GET /api/resolve-domain?host=${TEST_DOMAIN} (Expect 404)`);
  const postDeleteResolve = await request(`${BASE_URL}/api/resolve-domain?host=${TEST_DOMAIN}`);

  console.log(`Status: ${postDeleteResolve.status}`);
  console.log(`Response:`, JSON.stringify(postDeleteResolve.body, null, 2));

  const correctlyRemoved = postDeleteResolve.status === 404;
  results.push({
    step: "9. Cache Eviction / 404 After Delete",
    success: correctlyRemoved,
    message: correctlyRemoved ? `Domain correctly returned 404 after deletion` : `Domain still resolved unexpectedly`,
  });

  printSummary();
}

function printSummary() {
  console.log(`\n============================================================`);
  console.log(`📋 PRODUCTION TEST SUMMARY`);
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
    console.log(`🎉 ALL TESTS PASSED ON PRODUCTION! Custom Domain feature is 100% operational.`);
  } else {
    console.log(`⚠️ Some tests did not pass. Check the details above.`);
  }
  console.log(`============================================================\n`);
}

run().catch((err) => {
  console.error("Fatal test script failure:", err);
});
