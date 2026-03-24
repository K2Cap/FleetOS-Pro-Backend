import { useState, useEffect, useRef } from "react";

/* ── Brand tokens ── */
const G="#1a5c3a",G2="#236b47",GLt="#e8f5ee",GLt2="#d1ead9";
const S="#e8671a",SLt="#fdf0e8",SLt2="#fcd9c0";
const CR="#c0392b",CRLt="#fdecea";
const GO="#c9930a",GOLt="#fdf6e3";
const BL="#1a4a8c",BLLt="#e8eef8";
const BG="#f5f2ec",BG2="#edeae2",WH="#ffffff";
const INK="#1a1814",INK2="#3d3a34",MU="#7a7570",MU2="#b0aca4",BD="#ddd9d0",BD2="#eceae4";
const MOBILE_DENSE=true;
const OCR_SCAN_LOCK_KEY="fleetOcrScanInProgress";

/* ── Reg No formatter (AA 00 AA 0000) ── */
function formatRegNo(raw) {
  if (!raw) return "";
  const v = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = v.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  if (!m) return String(raw).toUpperCase();
  return `${m[1]} ${m[2].padStart(2,"0")} ${m[3].padEnd(1," ").trimEnd()} ${m[4].padStart(4,"0")}`.replace(/\s+/g," ").trim();
}

/* ── Location cleaner (Shows city only) ── */
const STATE_TOKENS = new Set([
  "andhra pradesh","arunachal pradesh","assam","bihar","chhattisgarh","goa","gujarat","haryana",
  "himachal pradesh","jharkhand","karnataka","kerala","madhya pradesh","maharashtra","manipur",
  "meghalaya","mizoram","nagaland","odisha","punjab","rajasthan","sikkim","tamil nadu","telangana",
  "tripura","uttar pradesh","uttarakhand","west bengal","andaman and nicobar islands","chandigarh",
  "dadra and nagar haveli and daman and diu","delhi","jammu and kashmir","ladakh","lakshadweep",
  "puducherry"
]);

function cleanLoc(str) {
  if (!str) return "";
  const parts = String(str)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];

  const filtered = [...parts];
  while (filtered.length && filtered[filtered.length - 1].toLowerCase() === "india") filtered.pop();
  while (filtered.length && STATE_TOKENS.has(filtered[filtered.length - 1].toLowerCase())) filtered.pop();

  return filtered[filtered.length - 1] || parts[parts.length - 1];
}

function formatRouteLabel(from, to) {
  return `${cleanLoc(from) || '---'} → ${cleanLoc(to) || '---'}`;
}

function startOfDayMs(value) {
  const dt = value ? new Date(value) : null;
  if (!dt || Number.isNaN(dt.getTime())) return null;
  dt.setHours(0, 0, 0, 0);
  return dt.getTime();
}

function computeTripOperationalDays(trip, allTrips = []) {
  const startMs = startOfDayMs(trip?.startDateRaw || trip?.start_date_raw || trip?.startDate);
  const endSource = trip?.status === 'Completed'
    ? (trip?.endDateRaw || trip?.end_date_raw || trip?.autoEndDateRaw || trip?.auto_end_date_raw || trip?.startDateRaw || trip?.start_date_raw)
    : (trip?.endDateRaw || trip?.end_date_raw || trip?.autoEndDateRaw || trip?.auto_end_date_raw || new Date().toISOString());
  const endMs = startOfDayMs(endSource) ?? startMs;

  const tripSpanMs = startMs !== null && endMs !== null ? Math.max(0, endMs - startMs) : 0;
  const actualDays = startMs !== null && endMs !== null ? Math.max(1, Math.floor(tripSpanMs / (1000 * 60 * 60 * 24)) + 1) : 1;

  const previousTrip = (allTrips || [])
    .filter((candidate) =>
      candidate &&
      candidate.id !== trip?.id &&
      String(candidate.truck || candidate.truckText || candidate.truck_text || '') === String(trip?.truck || trip?.truckText || trip?.truck_text || '')
    )
    .map((candidate) => ({
      trip: candidate,
      startMs: startOfDayMs(candidate.startDateRaw || candidate.start_date_raw || candidate.startDate)
    }))
    .filter((candidate) => candidate.startMs !== null && startMs !== null && candidate.startMs < startMs)
    .sort((a, b) => b.startMs - a.startMs)[0]?.trip || null;

  let idleDays = 0;
  if (previousTrip && startMs !== null) {
    const previousEndMs = startOfDayMs(previousTrip.endDateRaw || previousTrip.end_date_raw || previousTrip.autoEndDateRaw || previousTrip.auto_end_date_raw || previousTrip.startDateRaw || previousTrip.start_date_raw);
    if (previousEndMs !== null) {
      idleDays = Math.max(0, Math.round((startMs - previousEndMs) / (1000 * 60 * 60 * 24)) - 1);
    }
  }

  return {
    actualDays,
    idleDays,
    depreciationDays: actualDays + idleDays
  };
}

function toDateMs(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(ms) ? null : ms;
}

function formatRelativeTime(value) {
  const ms = typeof value === "number" ? value : toDateMs(value);
  if (ms === null) return "just now";
  const diff = Date.now() - ms;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))}m ago`;
  if (diff < day) return `${Math.max(1, Math.round(diff / hour))}h ago`;
  return `${Math.max(1, Math.round(diff / day))}d ago`;
}

function formatDateTime(value) {
  const dt = value ? new Date(value) : null;
  if (!dt || Number.isNaN(dt.getTime())) return "Unavailable";
  return dt.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatDateLabel(value) {
  const dt = value ? new Date(value) : null;
  if (!dt || Number.isNaN(dt.getTime())) return "Select Date";
  return dt.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatTimeLeftLabel(targetMs) {
  if (targetMs === null) return "Live tracking";
  const diff = targetMs - Date.now();
  if (diff <= 0) return "ETA due";
  const totalMinutes = Math.max(1, Math.round(diff / (1000 * 60)));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

function getTripProgressPct(trip) {
  const startMs = getTripTime(trip, ["startDateRaw", "start_date_raw", "startDate"]);
  const endMs = getTripTime(trip, ["autoEndDateRaw", "auto_end_date_raw", "endDateRaw", "end_date_raw"]);
  if (startMs !== null && endMs !== null && endMs > startMs) {
    const pct = ((Date.now() - startMs) / (endMs - startMs)) * 100;
    return Math.max(6, Math.min(98, Math.round(pct)));
  }
  const normalized = normalizeTripStatus(trip?.status);
  if (normalized === "delayed") return 92;
  if (normalized === "completed") return 100;
  return 48;
}

function buildLiveFleetMapRows(trips = []) {
  const palette = [
    { color: S, glow: "rgba(232,103,26,0.28)" },
    { color: GO, glow: "rgba(201,147,10,0.26)" },
    { color: G, glow: "rgba(26,92,58,0.24)" },
    { color: BL, glow: "rgba(26,74,140,0.24)" }
  ];

  return (trips || []).map((trip, index) => {
    const theme = palette[index % palette.length];
    const endMs = getTripTime(trip, ["autoEndDateRaw", "auto_end_date_raw", "endDateRaw", "end_date_raw"]);
    return {
      trip,
      color: theme.color,
      glow: theme.glow,
      routeLabel: formatRouteLabel(trip?.route, trip?.dest),
      truckLabel: formatRegNo(trip?.truck || trip?.truckText || trip?.truck_text || "Truck"),
      timeLabel: formatTimeLeftLabel(endMs),
      progressPct: getTripProgressPct(trip)
    };
  });
}

function normalizeTripStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "en route") return "active";
  return normalized;
}

function getTripTime(trip, keys) {
  for (const key of keys) {
    const ms = toDateMs(trip?.[key]);
    if (ms !== null) return ms;
  }
  return null;
}

function getCurrentMonthLabel(baseDate = new Date()) {
  return baseDate.toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function buildOperationalAlerts({ trips = [], fleetLocations = [], invoices = [] }) {
  const alerts = [];
  const now = Date.now();
  const pushAlert = (alert) => alerts.push({ id: `alert-${alerts.length + 1}`, ...alert });

  const tripsByTruck = new Map();
  (trips || []).forEach((trip) => {
    const truckId = String(trip?.truck || "").trim();
    if (!truckId) return;
    if (!tripsByTruck.has(truckId)) tripsByTruck.set(truckId, []);
    tripsByTruck.get(truckId).push(trip);
  });

  Array.from(tripsByTruck.entries()).forEach(([truckId, truckTrips]) => {
    const sorted = [...truckTrips].sort((a, b) => (getTripTime(b, ["endDateRaw", "autoEndDateRaw", "startDateRaw"]) || 0) - (getTripTime(a, ["endDateRaw", "autoEndDateRaw", "startDateRaw"]) || 0));
    const latestCompleted = sorted.find((trip) => normalizeTripStatus(trip.status) === "completed");
    const hasActiveReturnTrip = sorted.some((trip) => normalizeTripStatus(trip.status) === "active");
    if (!latestCompleted || hasActiveReturnTrip) return;

    const completedAt = getTripTime(latestCompleted, ["endDateRaw", "autoEndDateRaw", "startDateRaw"]);
    const idleDays = completedAt === null ? 0 : Math.floor((now - completedAt) / (1000 * 60 * 60 * 24));
    if (idleDays <= 2) return;

    pushAlert({
      type: "warn",
      icon: "🚚",
      title: "Idle truck without return load",
      desc: `${truckId} completed ${formatRouteLabel(latestCompleted.route, latestCompleted.dest)} and has been idle for ${idleDays} days.`,
      time: formatRelativeTime(completedAt),
      action: "Review truck",
      details: [
        ["Truck", truckId],
        ["Last completed trip", latestCompleted.id || "Trip closed"],
        ["Route", formatRouteLabel(latestCompleted.route, latestCompleted.dest)],
        ["Completed on", formatDateTime(completedAt)],
        ["Idle duration", `${idleDays} days without a new assignment`]
      ]
    });
  });

  (fleetLocations || []).forEach((loc) => {
    const hasActiveTrip = Boolean(loc.active_trip_id);
    if (loc.location_alert && hasActiveTrip) {
      pushAlert({
        type: "crit",
        icon: "📍",
        title: "Driver location turned off on active trip",
        desc: `${loc.full_name || "Driver"} stopped sharing location during trip ${loc.active_trip_id}.`,
        time: formatRelativeTime(loc.last_ping),
        action: "See details",
        details: [
          ["Driver", loc.full_name || "Unknown"],
          ["Truck", loc.assigned_truck || "Not assigned"],
          ["Trip ID", loc.active_trip_id],
          ["Route", formatRouteLabel(loc.active_trip_origin, loc.active_trip_destination)],
          ["Last ping", formatDateTime(loc.last_ping)],
          ["Alert", loc.location_alert]
        ]
      });
    }

    const lastPingMs = toDateMs(loc.last_ping);
    if (hasActiveTrip && lastPingMs !== null) {
      const hoursSilent = (now - lastPingMs) / (1000 * 60 * 60);
      if (hoursSilent >= 6 && !loc.location_alert) {
        pushAlert({
          type: "warn",
          icon: "📡",
          title: "Live tracking stale on active trip",
          desc: `${loc.full_name || "Driver"} has not sent a location ping for ${Math.round(hoursSilent)} hours.`,
          time: formatRelativeTime(lastPingMs),
          action: "Check live map",
          details: [
            ["Driver", loc.full_name || "Unknown"],
            ["Truck", loc.assigned_truck || "Not assigned"],
            ["Trip ID", loc.active_trip_id],
            ["Route", formatRouteLabel(loc.active_trip_origin, loc.active_trip_destination)],
            ["Last ping", formatDateTime(lastPingMs)],
            ["Status", `No fresh location update for ${Math.round(hoursSilent)} hours`]
          ]
        });
      }
    }
  });

  (trips || [])
    .filter((trip) => normalizeTripStatus(trip.status) === "active")
    .forEach((trip) => {
      const dueMs = getTripTime(trip, ["autoEndDateRaw", "endDateRaw"]);
      if (dueMs === null || now <= dueMs) return;
      const overdueHours = Math.max(1, Math.round((now - dueMs) / (1000 * 60 * 60)));
      pushAlert({
        type: overdueHours >= 24 ? "crit" : "warn",
        icon: "⏱️",
        title: "Active trip running beyond ETA",
        desc: `${trip.id || "Trip"} is overdue by ${overdueHours} hours on ${formatRouteLabel(trip.route, trip.dest)}.`,
        time: formatRelativeTime(dueMs),
        action: "Open trip",
        details: [
          ["Trip ID", trip.id || "Unknown"],
          ["Truck", trip.truck || "Unknown"],
          ["Driver", trip.driver || "Unknown"],
          ["Route", formatRouteLabel(trip.route, trip.dest)],
          ["ETA", formatDateTime(dueMs)],
          ["Delay", `${overdueHours} hours past planned completion`]
        ]
      });
    });

  (invoices || []).forEach((invoice) => {
    const status = String(invoice.status || "").toLowerCase();
    if (status !== "overdue") return;
    pushAlert({
      type: "info",
      icon: "🧾",
      title: "Invoice overdue for collection",
      desc: `${invoice.client || "Client"} has an overdue invoice ${invoice.num || ""} awaiting follow-up.`.trim(),
      time: invoice.date || "Pending",
      action: "Open finance",
      details: [
        ["Invoice", invoice.num || "Unnumbered"],
        ["Client", invoice.client || "Unknown"],
        ["Amount", `₹${Number(invoice.amount || 0).toLocaleString("en-IN")}`],
        ["Invoice date", invoice.date || "Unavailable"],
        ["Status", "Overdue"]
      ]
    });
  });

  return alerts.sort((a, b) => {
    const priority = { crit: 0, warn: 1, info: 2 };
    return (priority[a.type] ?? 9) - (priority[b.type] ?? 9);
  });
}

function buildDashboardBreakdowns({ trips = [], trucks = [], invoices = [], ledger = [], revenueMonth, selectedRevenuePoint = null }) {
  const baseDate = revenueMonth ? new Date(`${revenueMonth}-01T00:00:00`) : new Date();
  const safeDate = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate;
  const monthLabel = getCurrentMonthLabel(safeDate);
  const monthIndex = safeDate.getMonth();
  const year = safeDate.getFullYear();
  const isSameMonth = (value) => {
    const dt = value ? new Date(value) : null;
    return !!dt && !Number.isNaN(dt.getTime()) && dt.getMonth() === monthIndex && dt.getFullYear() === year;
  };

  const normalizedInvoices = (invoices || []).length ? invoices : buildInvoiceRowsFromTrips(trips);
  const currentMonthInvoices = normalizedInvoices.filter((inv) => isSameMonth(inv.date));
  const currentMonthTrips = (trips || []).filter((trip) => isSameMonth(getTripAccountingDate(trip)));
  const monthlyCostBreakdown = buildMonthlyCostBreakdown({ trips, ledger, monthIndex, year, selectedTrips: currentMonthTrips });
  const monthlyExpenseHeaders = buildMonthlyExpenseHeaderSummary({ trips, ledger, monthIndex, year, selectedTrips: currentMonthTrips });
  const monthlyExpenseHeaderTotalPaise = monthlyExpenseHeaders.reduce((sum, row) => sum + Number(row.amountPaise || 0), 0);
  const monthlyRevenueItems = currentMonthTrips.map((trip) => ({
    title: formatRouteLabel(trip.route, trip.dest),
    meta: trip.client || "Route Client",
    submeta: [trip.truck || "Truck", trip.driver || "Driver"].filter(Boolean).join(" • "),
    dateText: trip.startDate || trip.endDate || monthLabel,
    value: formatRupees(getTripFreightRupees(trip)),
    tone: "good"
  }));

  const activeTrips = (trips || []).filter((trip) => normalizeTripStatus(trip.status) === "active");
  const delayedTrips = (trips || []).filter((trip) => String(trip.status || "").toLowerCase() === "delayed");
  const fleetStatusCounts = {
    active: (trucks || []).filter((truck) => String(truck.status || "").toLowerCase() === "active").length,
    idle: (trucks || []).filter((truck) => String(truck.status || "").toLowerCase() === "idle").length,
    maintenance: (trucks || []).filter((truck) => String(truck.status || "").toLowerCase() === "maintenance").length,
    delayed: (trucks || []).filter((truck) => String(truck.status || "").toLowerCase() === "delayed").length
  };
  const pendingInvoices = normalizedInvoices.filter((inv) => String(inv.status || "").toLowerCase() !== "paid" && Number(inv.amount || 0) > 0);
  const totalInvoiceValue = pendingInvoices.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
  const monthlyRevenueRupees = selectedRevenuePoint
    ? Math.round(Number(selectedRevenuePoint.r || 0) * 100000)
    : currentMonthTrips.reduce((sum, trip) => sum + getTripFreightRupees(trip), 0);
  const monthlyExpensePaise = monthlyExpenseHeaderTotalPaise > 0
    ? monthlyExpenseHeaderTotalPaise
    : selectedRevenuePoint
      ? Math.round(Number(selectedRevenuePoint.c || 0) * 100000 * 100)
      : (monthlyCostBreakdown.totalPaise || 0);
  const monthlyProfitPaise = Math.round(monthlyRevenueRupees * 100) - monthlyExpensePaise;

  return {
    revenue: {
      title: "Monthly Revenue",
      subtitle: `${monthLabel} collections and open billings`,
      summary: monthlyRevenueItems.length
        ? `Showing ${monthlyRevenueItems.length} revenue line items for ${monthLabel}.`
        : `No revenue has been logged for ${monthLabel} yet.`,
      rows: monthlyRevenueItems,
      footer: currentMonthInvoices.length
        ? `${currentMonthInvoices.filter((inv) => String(inv.status || "").toLowerCase() === "paid").length} paid • ${currentMonthInvoices.filter((inv) => String(inv.status || "").toLowerCase() !== "paid").length} pending`
        : `${currentMonthTrips.length} trip${currentMonthTrips.length === 1 ? "" : "s"} closed this month`
    },
    trips: {
      title: "Active Trips",
      subtitle: "Live trips currently on road",
      summary: activeTrips.length
        ? `${activeTrips.length} trips are active right now.`
        : "No active trips are currently running.",
      rows: activeTrips.map((trip) => ({
        title: formatRouteLabel(trip.route, trip.dest),
        meta: `${trip.truck || "Truck"} • ${trip.driver || "Driver"} • ${trip.id || "Trip"}`,
        value: String(trip.status || "Active"),
        tone: String(trip.status || "").toLowerCase() === "delayed" ? "warn" : "good",
        trip
      })),
      footer: delayedTrips.length ? `${delayedTrips.length} delayed trip${delayedTrips.length === 1 ? "" : "s"} also need attention` : "All active trips are within schedule"
    },
    fleet: {
      title: "Fleet Utility",
      subtitle: "Current truck deployment snapshot",
      summary: `${fleetStatusCounts.active} of ${(trucks || []).length || 0} trucks are on duty right now.`,
      rows: [
        { title: "On duty", meta: "Active assignments", value: String(fleetStatusCounts.active), tone: "good" },
        { title: "Idle", meta: "Awaiting dispatch", value: String(fleetStatusCounts.idle), tone: "warn" },
        { title: "Maintenance", meta: "Workshop or hold", value: String(fleetStatusCounts.maintenance), tone: "neutral" },
        { title: "Delayed", meta: "Trips slipping schedule", value: String(fleetStatusCounts.delayed), tone: "warn" }
      ],
      footer: `${(trucks || []).length || 0} trucks in total fleet register`
    },
    invoices: {
      title: "Invoices",
      subtitle: "Invoices waiting for payment review",
      summary: pendingInvoices.length
        ? `${pendingInvoices.length} invoices are still open for collection.`
        : "No pending invoices right now.",
      rows: pendingInvoices.map((inv) => ({
        title: inv.client || inv.consignor || "Client",
        meta: [
          inv.num || "Invoice",
          inv.routeLabel || null,
          inv.date || "No date",
          inv.advanceAmount ? `Advance ${formatRupees(inv.advanceAmount)}` : null
        ].filter(Boolean).join(" • "),
        value: formatRupees(Number(inv.amount || 0)),
        tone: String(inv.status || "").toLowerCase() === "overdue" ? "warn" : "neutral",
        trip: inv.trip || null
      })),
      footer: `Open invoice balance: ${formatRupees(totalInvoiceValue)}`
    },
    costs: {
      title: "Cost Breakdown",
      subtitle: `${monthLabel} expense mix`,
      summary: monthlyCostBreakdown.totalPaise
        ? "Grouped into four operating buckets for the dashboard. Tap to see every cost item for the month."
        : "No cost entries logged this month.",
      rows: monthlyCostBreakdown.bucketRows.map((bucket) => ({
        title: bucket.label,
        meta: `${bucket.pct}% of total expenses`,
        value: formatPaise(bucket.amountPaise),
        tone: bucket.key === "fuelExpense" ? "good" : bucket.key === "borderExpense" ? "warn" : "neutral",
        pct: bucket.pct,
        bucketKey: bucket.key,
        color: bucket.color,
        bg: bucket.bg
      })),
      footer: monthlyCostBreakdown.totalPaise
        ? `Total monthly expenses: ${formatPaise(monthlyCostBreakdown.totalPaise)}`
        : "No costs captured for this month.",
      chartRows: monthlyCostBreakdown.bucketRows,
      detailRows: monthlyCostBreakdown.detailedRows
    },
    monthlyPerformance: {
      title: `${monthLabel} P&L`,
      subtitle: "Revenue, expenses, and final monthly profit in one view",
      summary: `Revenue ${formatRupees(monthlyRevenueRupees)} • Expenses ${formatPaise(monthlyExpensePaise)} • ${monthlyProfitPaise >= 0 ? "Profit" : "Loss"} ${formatPaise(Math.abs(monthlyProfitPaise))}`,
      footer: currentMonthTrips.length
        ? `${currentMonthTrips.length} trip${currentMonthTrips.length === 1 ? "" : "s"} contributed to this month.`
        : "No completed trips recorded for this month yet.",
      revenueRows: monthlyRevenueItems,
      costRows: monthlyExpenseHeaders,
      revenueRupees: monthlyRevenueRupees,
      expensePaise: monthlyExpensePaise,
      profitPaise: monthlyProfitPaise
    }
  };
}

function buildRecentCountSpark(items = [], getDateValue, monthCount = 6) {
  const now = new Date();
  const buckets = [];
  for (let i = monthCount - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${date.getFullYear()}-${date.getMonth()}`,
      value: 0
    });
  }
  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  (items || []).forEach((item) => {
    const rawDate = typeof getDateValue === "function" ? getDateValue(item) : null;
    const parsed = rawDate ? new Date(rawDate) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return;
    const bucket = bucketMap.get(`${parsed.getFullYear()}-${parsed.getMonth()}`);
    if (bucket) bucket.value += 1;
  });

  return buckets.map((bucket) => bucket.value);
}

/* ── Auth Helper ── */
function getApiHeaders() {
  const token = localStorage.getItem('fleetToken');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

function withFleetToken(url) {
  const token = localStorage.getItem('fleetToken');
  if (!token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

function navigateToAppPage(path, params = {}) {
  const url = new URL(path, window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  window.location.href = url.href;
}

function isOcrScanLocked() {
  try {
    return localStorage.getItem(OCR_SCAN_LOCK_KEY) === "1";
  } catch (err) {
    return false;
  }
}

/* ── Mock data (Removed) ── */
const TRIPS=[];
const TRUCKS=[];
const ALERTS_DATA=[];
const LEDGER=[];
const CHART=[];
const INVOICES=[];

/* ── Status helpers ── */
function statusInfo(s){
  return({active:{label:"Active",bg:GLt2,color:G},
    delayed:{label:"Delayed",bg:CRLt,color:CR},completed:{label:"Completed",bg:BLLt,color:BL},
    maintenance:{label:"Maint.",bg:SLt2,color:S}})[s]||{label:s,bg:BG2,color:INK2};
}

function expenseStatusInfo(status){
  const normalized=String(status||"In Process").toLowerCase();
  if(normalized==="approved") return {label:"Approved",bg:GLt2,color:G};
  if(normalized==="rejected") return {label:"Rejected",bg:CRLt,color:CR};
  return {label:"In Process",bg:GOLt,color:GO};
}

function formatPaise(value){
  return formatRupees((Number(value) || 0) / 100);
}

function formatIndianNumber(value, { decimals = 0, useDotForThousands = false } = {}) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
  const sign = numeric < 0 ? "-" : "";
  const absolute = Math.abs(numeric);
  const fixed = absolute.toFixed(Math.max(0, decimals));
  const [integerPart, fractionPart] = fixed.split(".");

  let grouped = integerPart;
  if (integerPart.length > 3) {
    if (useDotForThousands && integerPart.length <= 5) {
      grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    } else {
      const lastThree = integerPart.slice(-3);
      const rest = integerPart.slice(0, -3);
      grouped = `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}`;
    }
  }

  return `${sign}${grouped}${fractionPart ? `.${fractionPart}` : ""}`;
}

function formatRupees(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "₹0";
  return `₹${formatIndianNumber(Math.round(numeric), { useDotForThousands: true })}`;
}

function formatMonthInputLabel(value) {
  if (!value) return getCurrentMonthLabel(new Date());
  const [year, month] = String(value).split("-").map(Number);
  if (!year || !month) return getCurrentMonthLabel(new Date());
  return new Date(year, month - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function buildRevenueCostChartPoints(series = []) {
  const baseDate = new Date();
  return (series || []).map((point, index, arr) => {
    const offset = (arr.length - 1) - index;
    const dt = new Date(baseDate.getFullYear(), baseDate.getMonth() - offset, 1);
    return {
      ...point,
      key: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`,
      monthLabel: dt.toLocaleString("en-IN", { month: "short" }),
      fullLabel: dt.toLocaleString("en-IN", { month: "long", year: "numeric" }),
      profit: Number(point?.r || 0) - Number(point?.c || 0)
    };
  });
}

function buildCorrectedDashboardSeries(trips = [], ledger = [], chartPoints = []) {
  return (chartPoints || []).map((point) => {
    const [yearText, monthText] = String(point?.key || "").split("-");
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    if (!year || monthIndex < 0) {
      return {
        ...point,
        profit: Number(point?.r || 0) - Number(point?.c || 0)
      };
    }

    const monthTrips = (trips || []).filter((trip) => {
      const accountingDate = getTripAccountingDate(trip);
      if (!accountingDate) return false;
      const dt = new Date(accountingDate);
      return !Number.isNaN(dt.getTime()) && dt.getFullYear() === year && dt.getMonth() === monthIndex;
    });
    const revenueRupees = monthTrips.reduce((sum, trip) => sum + getTripFreightRupees(trip), 0);
    const expenseRows = buildMonthlyExpenseHeaderSummary({ trips, ledger, monthIndex, year, selectedTrips: monthTrips });
    const expensePaise = expenseRows.reduce((sum, row) => sum + Number(row.amountPaise || 0), 0);
    const revenueLakhs = Number((revenueRupees / 100000).toFixed(2));
    const expenseLakhs = Number(((expensePaise / 100) / 100000).toFixed(2));

    return {
      ...point,
      r: revenueLakhs,
      c: expenseLakhs,
      profit: Number((revenueLakhs - expenseLakhs).toFixed(2))
    };
  });
}

function buildRevenueExpenseSlides(points = []) {
  const pointMap = new Map((points || []).map((point) => [point.key, point]));
  const years = Array.from(new Set(
    (points || [])
      .map((point) => Number(String(point?.key || "").split("-")[0]))
      .filter(Boolean)
  )).sort((a, b) => a - b);
  const targetYears = years.length ? years : [new Date().getFullYear()];

  return targetYears.flatMap((year) => (
    [1, 7].map((monthStart) => ({
      key: `${year}-H${monthStart === 1 ? 1 : 2}`,
      year,
      yearLabel: String(year),
      rangeLabel: monthStart === 1 ? "Jan – Jun" : "Jul – Dec",
      months: Array.from({ length: 6 }, (_, idx) => {
        const monthNumber = monthStart + idx;
        const dt = new Date(year, monthNumber - 1, 1);
        const key = `${year}-${String(monthNumber).padStart(2, "0")}`;
        return pointMap.get(key) || {
          key,
          m: dt.toLocaleString("en-IN", { month: "short" }),
          fullLabel: dt.toLocaleString("en-IN", { month: "long", year: "numeric" }),
          r: 0,
          c: 0,
          profit: 0
        };
      })
    }))
  ));
}

function getTripBalanceRupees(trip) {
  const freightRupees = Number(trip?.freight || 0);
  const advanceRupees = Number(trip?.advance || 0);
  const storedBalanceRupees = trip?.balance === 0 ? 0 : Number(trip?.balance || NaN);
  const computedRupees = Number.isFinite(storedBalanceRupees) ? storedBalanceRupees : (freightRupees - advanceRupees);
  return Math.max(0, Math.round(computedRupees));
}

function getTripFreightRupees(trip) {
  return Math.max(0, Math.round(Number(trip?.freight || 0)));
}

function getTripAccountingDate(trip) {
  return trip?.startDateRaw || trip?.start_date_raw || trip?.startDate || trip?.start_date || trip?.created_at || null;
}

function parseFlexibleDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTripCompletionDate(trip) {
  return trip?.endDateRaw
    || trip?.end_date_raw
    || trip?.autoEndDateRaw
    || trip?.auto_end_date_raw
    || trip?.endDate
    || trip?.end_date
    || trip?.startDateRaw
    || trip?.start_date_raw
    || trip?.startDate
    || trip?.start_date
    || null;
}

function getCreditPeriodDays(trip) {
  const tripEndDate = parseFlexibleDate(getTripCompletionDate(trip));
  const paymentDate = parseFlexibleDate(trip?.paymentDate || trip?.payment_date);
  if (!tripEndDate || !paymentDate) return null;
  tripEndDate.setHours(0, 0, 0, 0);
  paymentDate.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((paymentDate.getTime() - tripEndDate.getTime()) / (1000 * 60 * 60 * 24)));
}

function buildInvoiceRowsFromTrips(trips = []) {
  return (trips || [])
    .filter((trip) => getTripBalanceRupees(trip) > 0)
    .map((trip) => {
      const balanceRupees = getTripBalanceRupees(trip);
      const freightRupees = getTripFreightRupees(trip);
      const advanceRupees = Math.max(0, Math.round(Number(trip?.advance || 0) / 100));
      const isPaid = Boolean(trip?.isPaid ?? trip?.is_paid);
      const paymentDate = trip?.paymentDate || trip?.payment_date || "";
      return {
        id: trip.inv_id || trip.id,
        num: trip.inv_id || trip.id,
        client: trip.client || trip.destination || "Route Client",
        consignor: trip.client || trip.destination || "Route Client",
        date: trip.startDate || trip.start_date || trip.startDateRaw || trip.start_date_raw,
        amount: balanceRupees,
        freightAmount: freightRupees,
        advanceAmount: advanceRupees,
        routeLabel: formatRouteLabel(trip.route || trip.origin, trip.dest || trip.destination),
        truck: trip.truck || trip.truck_text || "",
        driver: trip.driver || trip.driver_text || "",
        tripEndDate: getTripCompletionDate(trip),
        paymentDate,
        creditPeriodDays: getCreditPeriodDays({ ...trip, paymentDate }),
        status: isPaid ? "paid" : "pending",
        trip
      };
    })
    .sort((a, b) => {
      const statusWeight = (row) => String(row.status || "").toLowerCase() === "paid" ? 1 : 0;
      const statusDiff = statusWeight(a) - statusWeight(b);
      if (statusDiff !== 0) return statusDiff;
      return (parseFlexibleDate(b.paymentDate || b.tripEndDate || b.date)?.getTime() || 0) - (parseFlexibleDate(a.paymentDate || a.tripEndDate || a.date)?.getTime() || 0);
    });
}

const COST_BUCKET_STYLES = {
  fuelExpense: { key: "fuelExpense", label: "Fuel Expense", color: G, bg: GLt2 },
  depreciation: { key: "depreciation", label: "Depreciation", color: GO, bg: GOLt },
  driverBhatta: { key: "driverBhatta", label: "Driver Bhatta", color: S, bg: SLt },
  urea: { key: "urea", label: "Urea", color: BL, bg: BLLt },
  others: { key: "others", label: "Others", color: INK2, bg: BG2 }
};

function matchesAnyKeyword(value, keywords) {
  const normalized = String(value || "").toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function classifyLedgerExpenseBucket(entry) {
  const expenseType = String(entry?.expense_type || entry?.category || entry?.desc || "").toLowerCase();
  if (matchesAnyKeyword(expenseType, ["driver bhatta", "bhatta"])) return "driverBhatta";
  if (matchesAnyKeyword(expenseType, ["depreciation", "wear", "tyre", "tire", "maintenance", "repair", "service"])) return "depreciation";
  if (matchesAnyKeyword(expenseType, ["urea", "def", "adblue", "ad blue"])) return "urea";
  if (matchesAnyKeyword(expenseType, ["diesel", "fuel", "petrol", "cng", "lng"])) return "fuelExpense";
  return "others";
}

function classifyTripExpenseCategory(entry) {
  const text = [
    entry?.type,
    entry?.expense_type,
    entry?.category,
    entry?.merchant,
    entry?.notes,
    entry?.place,
    entry?.description,
    entry?.metadata?.vendor,
    entry?.metadata?.merchant,
    entry?.metadata?.description
  ].filter(Boolean).join(" ").toLowerCase();

  if (matchesAnyKeyword(text, ["driver bhatta", "bhatta"])) return "Driver Bhatta";
  if (matchesAnyKeyword(text, ["depreciation", "wear", "tyre", "tire", "maintenance", "repair", "service"])) return "Depreciation";
  if (matchesAnyKeyword(text, ["urea", "def", "adblue", "ad blue"])) return "Urea";
  if (matchesAnyKeyword(text, ["diesel", "fuel", "petrol", "cng", "lng"])) return "Fuel Expense";
  return "Others";
}

function buildMonthlyCostBreakdown({ trips = [], ledger = [], monthIndex, year, selectedTrips = null }) {
  const bucketTotals = {
    fuelExpense: 0,
    depreciation: 0,
    driverBhatta: 0,
    urea: 0,
    others: 0
  };
  const detailedRows = [];
  const isSameMonth = (value) => {
    const dt = value ? new Date(value) : null;
    return !!dt && !Number.isNaN(dt.getTime()) && dt.getMonth() === monthIndex && dt.getFullYear() === year;
  };
  const monthTrips = Array.isArray(selectedTrips)
    ? selectedTrips
    : (trips || []).filter((trip) => isSameMonth(getTripAccountingDate(trip)));
  const selectedTripIds = new Set(
    monthTrips
      .map((trip) => String(trip?.id || trip?.trip_id || "").trim())
      .filter(Boolean)
  );

  (ledger || []).forEach((entry) => {
    const entryTripId = String(entry?.trip_id || entry?.tripId || "").trim();
    const belongsToMonthTrip = entryTripId && selectedTripIds.has(entryTripId);
    const fallbackToExpenseDate = !entryTripId && isSameMonth(entry?.date || entry?.created_at);
    if (!belongsToMonthTrip && !fallbackToExpenseDate) return;
    const amountPaise = Number(entry?.total_paise ?? entry?.amount ?? 0) || 0;
    if (amountPaise <= 0) return;
    const bucketKey = classifyLedgerExpenseBucket(entry);
    bucketTotals[bucketKey] += amountPaise;
    detailedRows.push({
      title: entry?.expense_type || entry?.category || "Expense",
      meta: [COST_BUCKET_STYLES[bucketKey].label, entry?.date || "No date"].filter(Boolean).join(" • "),
      amountPaise,
      bucketKey
    });
  });

  monthTrips.forEach((trip) => {
    const dayMetrics = computeTripOperationalDays(trip, trips);
    const runningDays = dayMetrics.actualDays;
    const bhattaPaise = Math.round(runningDays * Number(trip?.bhatta || 0) * 100);
    const depreciationPaise = Math.round((((Number(trip?.truckPurchasePrice || 0) / (365 * 7)) * dayMetrics.depreciationDays) || 0) * 100);
    const tyreWearPaise = Math.round(((((Number(trip?.truckTyresCount || 0) * 25000) / 60000) * Number(trip?.distanceKm || 0)) || 0) * 100);
    const routeLabel = formatRouteLabel(trip?.route, trip?.dest);

    if (bhattaPaise > 0) {
      bucketTotals.driverBhatta += bhattaPaise;
      detailedRows.push({
        title: "Driver Bhatta",
        meta: [routeLabel, `${runningDays} day${runningDays === 1 ? "" : "s"}`].filter(Boolean).join(" • "),
        amountPaise: bhattaPaise,
        bucketKey: "driverBhatta"
      });
    }

    if (depreciationPaise > 0) {
      bucketTotals.depreciation += depreciationPaise;
      detailedRows.push({
        title: "Depreciation",
        meta: [routeLabel, `${dayMetrics.depreciationDays} asset day${dayMetrics.depreciationDays === 1 ? "" : "s"}`].filter(Boolean).join(" • "),
        amountPaise: depreciationPaise,
        bucketKey: "depreciation"
      });
    }

    if (tyreWearPaise > 0) {
      bucketTotals.depreciation += tyreWearPaise;
      detailedRows.push({
        title: "Tyre Wear & Tear",
        meta: [routeLabel, `${Number(trip?.distanceKm || 0).toLocaleString("en-IN")} km`].filter(Boolean).join(" • "),
        amountPaise: tyreWearPaise,
        bucketKey: "depreciation"
      });
    }
  });

  const totalPaise = Object.values(bucketTotals).reduce((sum, value) => sum + value, 0);
  const bucketRows = Object.values(COST_BUCKET_STYLES).map((bucket) => {
    const amountPaise = bucketTotals[bucket.key] || 0;
    const pct = totalPaise > 0 ? Math.round((amountPaise / totalPaise) * 100) : 0;
    return {
      ...bucket,
      amountPaise,
      pct
    };
  }).filter((bucket) => bucket.amountPaise > 0);

  const detailedPctRows = detailedRows
    .map((item) => ({
      ...item,
      pct: totalPaise > 0 ? (item.amountPaise / totalPaise) * 100 : 0
    }))
    .sort((a, b) => b.amountPaise - a.amountPaise);

  return {
    totalPaise,
    bucketRows,
    detailedRows: detailedPctRows
  };
}

function buildMonthlyExpenseHeaderSummary({ trips = [], ledger = [], monthIndex, year, selectedTrips = null }) {
  const totals = new Map([
    ["Fuel Expense", 0],
    ["Depreciation", 0],
    ["Driver Bhatta", 0],
    ["Urea", 0],
    ["Others", 0]
  ]);
  const counts = new Map([
    ["Fuel Expense", 0],
    ["Depreciation", 0],
    ["Driver Bhatta", 0],
    ["Urea", 0],
    ["Others", 0]
  ]);

  const isSameMonth = (value) => {
    const dt = value ? new Date(value) : null;
    return !!dt && !Number.isNaN(dt.getTime()) && dt.getMonth() === monthIndex && dt.getFullYear() === year;
  };

  const monthTrips = Array.isArray(selectedTrips)
    ? selectedTrips
    : (trips || []).filter((trip) => isSameMonth(getTripAccountingDate(trip)));
  const selectedTripIds = new Set(
    monthTrips
      .map((trip) => String(trip?.id || trip?.trip_id || "").trim())
      .filter(Boolean)
  );

  (ledger || []).forEach((entry) => {
    const entryTripId = String(entry?.trip_id || entry?.tripId || "").trim();
    const belongsToMonthTrip = entryTripId && selectedTripIds.has(entryTripId);
    if (!belongsToMonthTrip) return;
    const amountPaise = Number(entry?.total_paise ?? entry?.amount ?? 0) || 0;
    if (amountPaise <= 0) return;
    const label = classifyTripExpenseCategory(entry);
    totals.set(label, (totals.get(label) || 0) + amountPaise);
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  monthTrips.forEach((trip) => {
    const dayMetrics = computeTripOperationalDays(trip, trips);
    const runningDays = dayMetrics.actualDays;
    [
      Math.round(runningDays * Number(trip?.bhatta || 0) * 100),
      Math.round((((Number(trip?.truckPurchasePrice || 0) / (365 * 7)) * dayMetrics.depreciationDays) || 0) * 100),
      Math.round(((((Number(trip?.truckTyresCount || 0) * 25000) / 60000) * Number(trip?.distanceKm || 0)) || 0) * 100)
    ].forEach((amountPaise, index) => {
      if (amountPaise <= 0) return;
      const label = index === 0 ? "Driver Bhatta" : "Depreciation";
      totals.set(label, (totals.get(label) || 0) + amountPaise);
      counts.set(label, (counts.get(label) || 0) + 1);
    });
  });

  const orderedTitles = ["Fuel Expense", "Depreciation", "Driver Bhatta", "Urea", "Others"];
  return orderedTitles
    .map((title) => {
      const amountPaise = totals.get(title) || 0;
      const count = counts.get(title) || 0;
      return {
        title,
        meta: `${count} combined entr${count === 1 ? "y" : "ies"} this month`,
        amountPaise
      };
    })
    .filter((row) => row.amountPaise > 0)
}

/* ── Primitive components ── */
const Card=({children,style={}, onClick})=>(
  <div onClick={onClick} style={{background:WH,border:`1px solid ${BD}`,borderRadius:12,
    boxShadow:"0 1px 4px rgba(26,24,20,0.07)",overflow:"hidden",...style}}>
    {children}
  </div>
);

const StatusChip=({status})=>{
  const {label,bg,color}=statusInfo(status);
  return(
    <span style={{display:"inline-flex",alignItems:"center",gap:5,background:bg,color,
      fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:20}}>
      <span style={{width:5,height:5,borderRadius:"50%",background:color,display:"inline-block"}}/>
      {label}
    </span>
  );
};

const Tag=({color,bg,children,style={}})=>(
  <span style={{display:"inline-flex",alignItems:"center",background:bg,color,
    fontSize:9.5,fontWeight:700,padding:"3px 8px",borderRadius:20,...style}}>
    {children}
  </span>
);

const PnlPill=({amount})=>{
  const pos=amount>=0;
  return(
    <span style={{display:"inline-flex",alignItems:"center",
      background:pos?GLt2:CRLt,color:pos?G:CR,
      fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:700,
      padding:"4px 10px",borderRadius:8}}>
      {pos?"+":""}₹{(Math.abs(amount)/1000).toFixed(1)}k
    </span>
  );
};

const SecHd=({left,action,onAction,style={}})=>(
  <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",
    marginBottom:14,paddingBottom:10,borderBottom:`2px solid ${INK}`,...style}}>
    <div style={{fontFamily:"'Sora',sans-serif",fontWeight:900,fontSize:18,
      color:INK,letterSpacing:-0.5}}>{left}</div>
    {action&&<span onClick={onAction} style={{fontSize:11,fontWeight:700,color:G,cursor:"pointer"}}>{action}</span>}
  </div>
);

function DetailSheet({ title, subtitle, rows = [], summary, footer, onClose, controls = null, onRowClick = null }) {
  const toneStyle = {
    good: { color: G, bg: GLt2 },
    warn: { color: S, bg: SLt },
    neutral: { color: INK2, bg: BG }
  };

  return(
    <div style={{position:'fixed',inset:0,background:'rgba(26,24,20,0.5)',backdropFilter:'blur(6px)',zIndex:150000,display:'flex',alignItems:'flex-end',justifyContent:'center',padding:12}} onClick={onClose}>
      <div style={{background:WH,border:`1px solid ${BD}`,borderRadius:'24px 24px 0 0',width:'100%',maxWidth:420,maxHeight:'78vh',overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 -8px 30px rgba(26,24,20,0.18)'}} onClick={(e)=>e.stopPropagation()}>
        <div style={{padding:'12px 18px 0',display:'flex',justifyContent:'center'}}>
          <div style={{width:46,height:5,borderRadius:999,background:BD}} />
        </div>
        <div style={{padding:'16px 18px 14px',borderBottom:`1px solid ${BD}`}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start'}}>
            <div>
              <div style={{fontFamily:"'Sora',sans-serif",fontSize:18,fontWeight:900,color:INK}}>{title}</div>
              {subtitle && <div style={{fontSize:11.5,color:MU,marginTop:4,lineHeight:1.5}}>{subtitle}</div>}
            </div>
            <button onClick={onClose} style={{border:'none',background:'transparent',fontSize:22,color:MU,cursor:'pointer',lineHeight:1}}>×</button>
          </div>
          {controls && <div style={{marginTop:12}}>{controls}</div>}
          {summary && <div style={{marginTop:12,fontSize:12,color:INK2,lineHeight:1.55,background:BG,padding:'10px 12px',borderRadius:12}}>{summary}</div>}
        </div>
        <div style={{padding:'14px 18px 18px',overflowY:'auto'}} className="no-scrollbar">
          {rows.length ? rows.map((row, index) => {
            const tone = toneStyle[row.tone] || toneStyle.neutral;
            const isClickable = typeof onRowClick === "function" && !!row;
            return(
              <div
                key={`${row.title}-${index}`}
                onClick={isClickable ? () => onRowClick(row) : undefined}
                style={{
                  padding:'12px 0',
                  borderBottom:index < rows.length - 1 ? `1px solid ${BD2}` : 'none',
                  display:'flex',
                  justifyContent:'space-between',
                  gap:12,
                  cursor:isClickable ? 'pointer' : 'default'
                }}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:12.5,fontWeight:800,color:INK,marginBottom:4}}>{row.title}</div>
                  <div style={{fontSize:11,color:MU,lineHeight:1.45}}>{row.meta}</div>
                </div>
                <div style={{alignSelf:'center',flexShrink:0,maxWidth:'42%',textAlign:'right'}}>
                  <span style={{display:'inline-flex',padding:'5px 9px',borderRadius:999,background:tone.bg,color:tone.color,fontSize:10.5,fontWeight:800}}>{row.value}</span>
                  {isClickable && <div style={{fontSize:10,color:MU,marginTop:6,fontWeight:700}}>Tap for details</div>}
                </div>
              </div>
            );
          }) : (
            <div style={{padding:'28px 0',textAlign:'center',color:MU,fontSize:12}}>Nothing to show yet.</div>
          )}
          {footer && <div style={{marginTop:14,padding:'12px 14px',borderRadius:14,background:GLt,fontSize:11.5,fontWeight:700,color:G}}>{footer}</div>}
        </div>
      </div>
    </div>
  );
}


/* ── Bar Chart ── */
function RevenueExpenseCarousel({ slides = [], selectedKey = null, onSelectMonth = null }) {
  const chartScrollerRef = useRef(null);
  const profitScrollerRef = useRef(null);
  const syncSourceRef = useRef(null);

  function syncScroll(source, target, sourceName) {
    if (!source || !target) return;
    if (syncSourceRef.current && syncSourceRef.current !== sourceName) return;
    syncSourceRef.current = sourceName;
    target.scrollLeft = source.scrollLeft;
    window.requestAnimationFrame(() => {
      syncSourceRef.current = null;
    });
  }

  useEffect(() => {
    if (!chartScrollerRef.current || !profitScrollerRef.current || !slides.length || !selectedKey) return;
    const targetIndex = slides.findIndex((slide) => slide.months.some((month) => month.key === selectedKey));
    if (targetIndex < 0) return;
    const chartScroller = chartScrollerRef.current;
    const profitScroller = profitScrollerRef.current;
    const chartChild = chartScroller.children[targetIndex];
    const profitChild = profitScroller.children[targetIndex];
    if (!chartChild || !profitChild) return;
    chartScroller.scrollTo({
      left: chartChild.offsetLeft,
      behavior: 'auto'
    });
    profitScroller.scrollTo({
      left: profitChild.offsetLeft,
      behavior: 'auto'
    });
  }, [slides, selectedKey]);

  if (!slides.length) return <div style={{height:180, display:'flex', alignItems:'center', justifyContent:'center', color:MU, fontSize:11}}>No data available</div>;
  const allValues = slides.flatMap((slide) => slide.months.flatMap((month) => [Number(month.r || 0), Number(month.c || 0)]));
  const peakValue = Math.max(...allValues, 1);
  const axisTop = Math.max(2, Math.ceil(peakValue / 2) * 2);
  const axisMid = axisTop / 2;
  const axisValues = [axisTop, axisMid, 0];
  const chartHeight = 120;

  return (
    <div>
      <div
        ref={chartScrollerRef}
        onScroll={(event) => syncScroll(event.currentTarget, profitScrollerRef.current, 'chart')}
        style={{display:'flex', overflowX:'auto', scrollSnapType:'x mandatory', gap:12, padding:'0 2px 4px'}}
        className="no-scrollbar"
      >
      {slides.map((slide) => (
        <div key={slide.key} style={{minWidth:'calc(100% - 4px)', scrollSnapAlign:'start', boxSizing:'border-box'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
            <div style={{fontFamily:"'Sora',sans-serif", fontSize:13, fontWeight:800, color:INK}}>{slide.rangeLabel}</div>
            <div style={{fontSize:10, fontWeight:800, color:MU2, letterSpacing:0.8, textTransform:'uppercase'}}>6 months</div>
          </div>
          <div style={{display:'flex', gap:10}}>
            <div style={{width:34, display:'flex', flexDirection:'column', justifyContent:'space-between', height:chartHeight, paddingTop:2, paddingBottom:18}}>
              {axisValues.map((value, index) => (
                <div key={`${slide.key}-axis-${index}`} style={{fontSize:9, fontWeight:700, color:MU, textAlign:'right'}}>
                  {value > 0 ? formatIndianNumber(Math.round(value * 100000), { useDotForThousands: true }) : '0'}
                </div>
              ))}
            </div>
            <div style={{flex:1}}>
              <div style={{display:'grid', gridTemplateColumns:'repeat(6, minmax(0, 1fr))', gap:8, alignItems:'end', height:chartHeight, borderLeft:`1px solid ${BD2}`, borderBottom:`1px solid ${BD2}`, padding:'0 0 10px 10px', background:`linear-gradient(to top, ${BG} 0%, transparent 1px)`}}>
                {slide.months.map((month, idx) => (
                  <div key={month.key || idx} onClick={() => onSelectMonth && onSelectMonth(month)} style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-end', cursor:onSelectMonth ? 'pointer' : 'default', height:'100%'}}>
                    <div style={{display:'flex', alignItems:'flex-end', gap:3, height:'100%'}}>
                      <div style={{width:10, borderRadius:'4px 4px 0 0', background:G, height:`${Math.max(4, Math.round((Number(month.r || 0) / axisTop) * (chartHeight - 24)))}px`}} />
                      <div style={{width:10, borderRadius:'4px 4px 0 0', background:S, height:`${Math.max(4, Math.round((Number(month.c || 0) / axisTop) * (chartHeight - 24)))}px`}} />
                    </div>
                    <div style={{marginTop:8, fontSize:8.5, color:selectedKey === month.key ? INK : MU2, letterSpacing:0.3, fontWeight:selectedKey === month.key ? 800 : 600}}>{month.m}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
      </div>
      <div style={{textAlign:'center', marginTop:8, fontSize:11, fontWeight:800, color:MU, letterSpacing:1, textTransform:'uppercase'}}>
        {slides.find((slide) => slide.months.some((month) => month.key === selectedKey))?.yearLabel || slides[0]?.yearLabel || ''}
      </div>
      <div style={{fontFamily:"'Sora',sans-serif", fontSize:13, fontWeight:800, color:INK, margin:'10px 0 8px'}}>Monthly Profit</div>
      <div
        ref={profitScrollerRef}
        onScroll={(event) => syncScroll(event.currentTarget, chartScrollerRef.current, 'profit')}
        style={{display:'flex', overflowX:'auto', scrollSnapType:'x mandatory', gap:12, padding:'0 2px 4px'}}
        className="no-scrollbar"
      >
        {slides.map((slide) => (
          <div key={`${slide.key}-profit-slide`} style={{minWidth:'calc(100% - 4px)', scrollSnapAlign:'start', boxSizing:'border-box'}}>
            <div style={{display:'grid', gridTemplateColumns:'repeat(6, minmax(0, 1fr))', gap:8}}>
              {slide.months.map((month) => {
                const active = selectedKey === month.key;
                const positive = Number(month.profit || 0) >= 0;
                return (
                  <div key={`${slide.key}-${month.key}-profit`} onClick={() => onSelectMonth && onSelectMonth(month)} style={{background:active ? WH : BG, border:`1px solid ${active ? (positive ? `${G}55` : `${CR}55`) : BD}`, borderRadius:14, padding:'10px 6px', cursor:onSelectMonth ? 'pointer' : 'default', textAlign:'center', boxShadow:active ? '0 6px 14px rgba(26,24,20,0.06)' : 'none'}}>
                    <div style={{fontSize:9, fontWeight:800, color:MU, textTransform:'uppercase', letterSpacing:0.8, marginBottom:4}}>{month.m}</div>
                    <div style={{fontFamily:"'Sora',sans-serif", fontSize:11.5, fontWeight:900, color:positive ? G : CR, letterSpacing:-0.3}}>
                      {positive ? '' : '-'}{formatRupees(Math.round(Math.abs(Number(month.profit || 0)) * 100000))}
                    </div>
                    <div style={{fontSize:9, color:MU2, marginTop:4}}>{positive ? 'Profit' : 'Loss'}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Donut ── */
function DonutChart({data=[]}){
  if(!data || data.length === 0) return <div style={{height:100, display:'flex', alignItems:'center', justifyContent:'center', color:MU, fontSize:11}}>No expenses recorded</div>;
  const total = data.reduce((a,b)=>a+b.value, 0);
  const segs = data.map(d => ({
    pct: total > 0 ? Math.round((d.value/total)*100) : 0,
    color: d.color,
    label: d.label
  })).filter(s => s.pct > 0);

  const r=38,circ=2*Math.PI*r;
  let acc=0;
  return(
    <div style={{display:"flex",alignItems:"center",gap:16}}>
      <svg viewBox="0 0 100 100" style={{width:90,height:90,flexShrink:0}}>
        <g style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%"}}>
          <circle cx="50" cy="50" r={r} fill="none" stroke={BG2} strokeWidth={14}/>
          {segs.map((s,i)=>{
            const dash=circ*(s.pct/100);
            const el=(
              <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={s.color}
                strokeWidth={13} strokeDasharray={`${dash} ${circ}`}
                strokeDashoffset={-acc} strokeLinecap="round"/>
            );
            acc+=dash;
            return el;
          })}
        </g>
        <text x="50" y="47" textAnchor="middle"
          style={{fontFamily:"'Sora',sans-serif",fontWeight:900,fontSize:14,fill:INK}}>{segs[0]?.pct || 0}%</text>
        <text x="50" y="60" textAnchor="middle"
          style={{fontFamily:"'DM Sans',sans-serif",fontSize:7,fill:MU}}>{segs[0]?.label || 'None'}</text>
      </svg>
      <div style={{flex:1,display:"flex",flexDirection:"column",gap:6}}>
        {segs.map((s,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:s.color,flexShrink:0}}/>
            <div style={{flex:1,fontSize:11,color:INK2,fontWeight:500}}>{s.label}</div>
            <div style={{fontSize:10.5,fontFamily:"'JetBrains Mono',monospace",color:MU}}>{s.pct}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CostBreakdownBars({ rows = [] }) {
  if (!rows.length) {
    return <div style={{height:100, display:'flex', alignItems:'center', justifyContent:'center', color:MU, fontSize:11}}>No expenses recorded</div>;
  }
  return (
    <div style={{display:"flex", flexDirection:"column", gap:10}}>
      {rows.map((row) => (
        <div key={row.key || row.title}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5, gap:8}}>
            <div style={{fontSize:11.5, fontWeight:800, color:INK}}>{row.label || row.title}</div>
            <div style={{fontSize:10.5, fontWeight:800, color:MU}}>{row.pct}%</div>
          </div>
          <div style={{height:10, borderRadius:999, background:BG2, overflow:"hidden"}}>
            <div style={{height:"100%", width:`${Math.max(row.pct, row.pct > 0 ? 6 : 0)}%`, background:row.color || G, borderRadius:999, transition:"width 0.25s ease"}} />
          </div>
        </div>
      ))}
    </div>
  );
}

function LiveFleetMapCard({ trips = [], onOpen }) {
  const liveTrips = (trips || [])
    .filter((trip) => {
      const status = normalizeTripStatus(trip?.status);
      return status === "active" || status === "delayed";
    })
    .sort((a, b) => {
      const aEta = getTripTime(a, ["autoEndDateRaw", "auto_end_date_raw", "endDateRaw", "end_date_raw"]) ?? Number.MAX_SAFE_INTEGER;
      const bEta = getTripTime(b, ["autoEndDateRaw", "auto_end_date_raw", "endDateRaw", "end_date_raw"]) ?? Number.MAX_SAFE_INTEGER;
      return aEta - bEta;
    });

  const rows = buildLiveFleetMapRows(liveTrips);
  const visibleRows = rows.slice(0, rows.length >= 3 ? 4 : rows.length);
  const corridorCount = new Set(rows.map((row) => row.routeLabel)).size;
  const avgProgress = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.progressPct, 0) / rows.length) : 0;
  const showSummary = rows.length >= 3;

  return (
    <Card onClick={onOpen} style={{ cursor: 'pointer', overflow:"hidden", borderRadius:22 }}>
      <div style={{position:"relative",background:WH,border:`1.5px solid ${BD}`,borderRadius:22,overflow:"hidden",boxShadow:"0 2px 8px rgba(26,24,20,0.07)"}}>
        {showSummary && (
          <div style={{padding:"16px 18px 14px",display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:14,borderBottom:`1px solid ${BG2}`,background:"linear-gradient(135deg, rgba(26,92,58,0.04) 0%, transparent 100%)"}}>
            <div>
              <div style={{fontFamily:"'Fraunces',serif",fontSize:44,fontWeight:900,color:G,lineHeight:1,letterSpacing:-2}}>{rows.length}</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,letterSpacing:1,textTransform:"uppercase",color:MU,marginTop:4}}>On Route</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,letterSpacing:0.8,textTransform:"uppercase",color:MU,marginBottom:2}}>Corridors</div>
              <div style={{fontSize:15,fontWeight:700,color:INK,lineHeight:1.3}}>{corridorCount} active</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9,letterSpacing:0.8,textTransform:"uppercase",color:MU,marginTop:8,marginBottom:2}}>Avg Progress</div>
              <div style={{fontSize:15,fontWeight:700,color:S,lineHeight:1.3}}>{avgProgress}%</div>
            </div>
          </div>
        )}

        <div style={{padding:"4px 0"}}>
          {visibleRows.length ? visibleRows.map((row, index) => (
            <div key={row.trip?.id || `${row.routeLabel}-${index}`} style={{display:"flex",alignItems:"center",gap:11,padding:"10px 18px",borderBottom:index === visibleRows.length - 1 ? "none" : `1px solid ${BG2}`}}>
              <div style={{width:3,height:34,borderRadius:99,background:row.color,opacity:index > 0 && showSummary ? 0.55 : 1,flexShrink:0}} />
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13.5,fontWeight:700,letterSpacing:-0.1,color:INK,lineHeight:1.2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                  {row.routeLabel}
                </div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9.5,color:MU,letterSpacing:0.06,marginTop:3}}>
                  {row.truckLabel} · {row.timeLabel}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,fontWeight:500,letterSpacing:0.04,color:row.color,opacity:index > 0 && showSummary ? 0.7 : 1}}>
                  {row.progressPct}%
                </div>
                <div style={{width:54,height:3,background:BG2,borderRadius:99,marginTop:6,position:"relative",overflow:"visible"}}>
                  <div style={{width:`${row.progressPct}%`,height:"100%",background:row.color,borderRadius:99,position:"relative",opacity:index > 0 && showSummary ? 0.7 : 1}}>
                    <span style={{position:"absolute",right:-3,top:-3,width:9,height:9,borderRadius:"50%",border:`2px solid ${WH}`,background:row.color,boxShadow:`0 0 5px ${row.glow}`}} />
                  </div>
                </div>
              </div>
            </div>
          )) : (
            <div style={{padding:"18px 16px",fontSize:11.5,color:MU,textAlign:"center"}}>
              No trucks are currently live on route.
            </div>
          )}
        </div>

        {rows.length > visibleRows.length && (
          <div style={{padding:"0 18px 10px",fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:MU,letterSpacing:0.08,textTransform:"uppercase"}}>
            +{rows.length - visibleRows.length} more trip{rows.length - visibleRows.length === 1 ? "" : "s"} on full map
          </div>
        )}

        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"13px 18px",borderTop:`1px solid ${BG2}`,background:"transparent"}}>
          <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,letterSpacing:1.2,textTransform:"uppercase",color:G,fontWeight:500}}>
            Open full map
          </span>
          <svg viewBox="0 0 14 14" fill="none" style={{width:14,height:14,stroke:G,strokeWidth:1.8,strokeLinecap:"round",strokeLinejoin:"round"}}>
            <path d="M2 6.5h9M8 3l3.5 3.5L8 10" />
          </svg>
        </div>
      </div>
    </Card>
  );
}

function CostBreakdownDetailSheet({ title, subtitle, rows = [], summary, footer, onClose }) {
  const [activeKey, setActiveKey] = useState(rows[0]?.title || null);
  const total = rows.reduce((sum, row) => sum + row.pct, 0) || 1;
  let cumulative = 0;
  const segments = rows.map((row) => {
    const pct = row.pct / total;
    const start = cumulative;
    cumulative += pct;
    return { ...row, start, end: cumulative };
  });
  const activeRow = rows.find((row) => row.title === activeKey) || rows[0] || null;

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(26,24,20,0.5)',backdropFilter:'blur(6px)',zIndex:150000,display:'flex',alignItems:'flex-end',justifyContent:'center',padding:12}} onClick={onClose}>
      <div style={{background:WH,border:`1px solid ${BD}`,borderRadius:'24px 24px 0 0',width:'100%',maxWidth:420,maxHeight:'82vh',overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 -8px 30px rgba(26,24,20,0.18)'}} onClick={(e)=>e.stopPropagation()}>
        <div style={{padding:'12px 18px 0',display:'flex',justifyContent:'center'}}>
          <div style={{width:46,height:5,borderRadius:999,background:BD}} />
        </div>
        <div style={{padding:'16px 18px 14px',borderBottom:`1px solid ${BD}`}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start'}}>
            <div>
              <div style={{fontFamily:"'Sora',sans-serif",fontSize:18,fontWeight:900,color:INK}}>{title}</div>
              {subtitle && <div style={{fontSize:11.5,color:MU,marginTop:4,lineHeight:1.5}}>{subtitle}</div>}
            </div>
            <button onClick={onClose} style={{border:'none',background:'transparent',fontSize:22,color:MU,cursor:'pointer',lineHeight:1}}>×</button>
          </div>
          {summary && <div style={{marginTop:12,fontSize:12,color:INK2,lineHeight:1.55,background:BG,padding:'10px 12px',borderRadius:12}}>{summary}</div>}
        </div>
        <div style={{padding:'16px 18px 18px',overflowY:'auto'}} className="no-scrollbar">
          {rows.length ? (
            <>
              <div style={{display:"flex", alignItems:"center", gap:14, marginBottom:18}}>
                <svg viewBox="0 0 100 100" style={{width:104,height:104,flexShrink:0}}>
                  <g style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%"}}>
                    <circle cx="50" cy="50" r="34" fill="none" stroke={BG2} strokeWidth="16" />
                    {segments.map((segment) => {
                      const circumference = 2 * Math.PI * 34;
                      const dash = circumference * (segment.pct / 100);
                      const offset = -circumference * segment.start;
                      return (
                        <circle
                          key={segment.title}
                          cx="50"
                          cy="50"
                          r="34"
                          fill="none"
                          stroke={segment.color || G}
                          strokeWidth={segment.title === activeKey ? 18 : 14}
                          strokeDasharray={`${dash} ${circumference}`}
                          strokeDashoffset={offset}
                          strokeLinecap="round"
                          style={{cursor:"pointer", transition:"all 0.2s ease"}}
                          onClick={() => setActiveKey(segment.title)}
                        />
                      );
                    })}
                  </g>
                  <text x="50" y="47" textAnchor="middle" style={{fontFamily:"'Sora',sans-serif",fontSize:18,fontWeight:900,fill:INK}}>
                    {activeRow ? `${Math.round(activeRow.pct)}%` : "0%"}
                  </text>
                  <text x="50" y="61" textAnchor="middle" style={{fontSize:8.5,fontWeight:700,fill:MU}}>
                    {activeRow ? activeRow.title : "No data"}
                  </text>
                </svg>
                <div style={{flex:1, minWidth:0}}>
                  {activeRow && (
                    <>
                      <div style={{fontSize:13, fontWeight:900, color:INK, marginBottom:4}}>{activeRow.title}</div>
                      <div style={{fontSize:11, color:MU, lineHeight:1.5}}>{activeRow.meta}</div>
                      <div style={{marginTop:8, display:"inline-flex", padding:"5px 10px", borderRadius:999, background:activeRow.bg || BG, color:activeRow.color || INK2, fontSize:10.5, fontWeight:800}}>
                        {formatPaise(activeRow.amountPaise)}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div style={{display:"flex", flexDirection:"column", gap:10}}>
                {rows.map((row) => (
                  <div key={row.title} onClick={() => setActiveKey(row.title)} style={{padding:"10px 12px", border:`1px solid ${row.title === activeKey ? (row.color || G) : BD}`, borderRadius:14, cursor:"pointer", background:row.title === activeKey ? (row.bg || BG) : WH}}>
                    <div style={{display:"flex", justifyContent:"space-between", gap:10, alignItems:"center"}}>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:12, fontWeight:800, color:INK}}>{row.title}</div>
                        <div style={{fontSize:10.5, color:MU, marginTop:3, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{row.meta}</div>
                      </div>
                      <div style={{textAlign:"right", flexShrink:0}}>
                        <div style={{fontSize:11, fontWeight:900, color:row.color || G}}>{row.pct.toFixed(1)}%</div>
                        <div style={{fontSize:10.5, color:MU, marginTop:2}}>{formatPaise(row.amountPaise)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{padding:'28px 0',textAlign:'center',color:MU,fontSize:12}}>Nothing to show yet.</div>
          )}
          {footer && <div style={{marginTop:14,padding:'12px 14px',borderRadius:14,background:GLt,fontSize:11.5,fontWeight:700,color:G}}>{footer}</div>}
        </div>
      </div>
    </div>
  );
}

function MonthlyPerformanceDetailSheet({ details, onClose }) {
  if (!details) return null;
  const profitPositive = details.profitPaise >= 0;
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(26,24,20,0.5)',backdropFilter:'blur(6px)',zIndex:150000,display:'flex',alignItems:'flex-end',justifyContent:'center',padding:12}} onClick={onClose}>
      <div style={{background:WH,border:`1px solid ${BD}`,borderRadius:'24px 24px 0 0',width:'100%',maxWidth:420,maxHeight:'84vh',overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 -8px 30px rgba(26,24,20,0.18)'}} onClick={(e)=>e.stopPropagation()}>
        <div style={{padding:'12px 18px 0',display:'flex',justifyContent:'center'}}>
          <div style={{width:46,height:5,borderRadius:999,background:BD}} />
        </div>
        <div style={{padding:'16px 18px 14px',borderBottom:`1px solid ${BD}`}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start'}}>
            <div>
              <div style={{fontFamily:"'Sora',sans-serif",fontSize:18,fontWeight:900,color:INK}}>{details.title}</div>
              {details.subtitle && <div style={{fontSize:11.5,color:MU,marginTop:4,lineHeight:1.5}}>{details.subtitle}</div>}
            </div>
            <button onClick={onClose} style={{border:'none',background:'transparent',fontSize:22,color:MU,cursor:'pointer',lineHeight:1}}>×</button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:14}}>
            <div style={{background:GLt,borderRadius:14,padding:'10px 12px'}}>
              <div style={{fontSize:9.5,fontWeight:800,color:MU,textTransform:'uppercase',letterSpacing:0.8}}>Revenue</div>
              <div style={{fontFamily:"'Sora',sans-serif",fontSize:16,fontWeight:900,color:G,marginTop:4}}>{formatRupees(details.revenueRupees)}</div>
            </div>
            <div style={{background:CRLt,borderRadius:14,padding:'10px 12px'}}>
              <div style={{fontSize:9.5,fontWeight:800,color:MU,textTransform:'uppercase',letterSpacing:0.8}}>Expenses</div>
              <div style={{fontFamily:"'Sora',sans-serif",fontSize:16,fontWeight:900,color:CR,marginTop:4}}>{formatPaise(details.expensePaise)}</div>
            </div>
            <div style={{background:profitPositive ? GLt2 : SLt,borderRadius:14,padding:'10px 12px'}}>
              <div style={{fontSize:9.5,fontWeight:800,color:MU,textTransform:'uppercase',letterSpacing:0.8}}>Profit</div>
              <div style={{fontFamily:"'Sora',sans-serif",fontSize:16,fontWeight:900,color:profitPositive ? G : CR,marginTop:4}}>
                {profitPositive ? '' : '-'}{formatPaise(Math.abs(details.profitPaise))}
              </div>
            </div>
          </div>
          {details.summary && <div style={{marginTop:12,fontSize:12,color:INK2,lineHeight:1.55,background:BG,padding:'10px 12px',borderRadius:12}}>{details.summary}</div>}
        </div>
        <div style={{padding:'14px 18px 18px',overflowY:'auto'}} className="no-scrollbar">
          <div style={{fontFamily:"'Sora',sans-serif",fontSize:14,fontWeight:800,color:INK,marginBottom:10}}>Revenue Details</div>
          {details.revenueRows?.length ? details.revenueRows.map((row, index) => (
            <div key={`rev-${row.title}-${index}`} style={{padding:'12px 0',borderBottom:`1px solid ${BD2}`,display:'flex',justifyContent:'space-between',gap:12}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:12.5,fontWeight:800,color:INK,marginBottom:4}}>{row.title}</div>
                {row.meta && <div style={{fontSize:11,color:MU,lineHeight:1.45}}>{row.meta}</div>}
                {row.submeta && <div style={{fontSize:11,color:MU,lineHeight:1.45}}>{row.submeta}</div>}
                {row.dateText && <div style={{fontSize:11,color:MU,lineHeight:1.45}}>{row.dateText}</div>}
              </div>
              <div style={{alignSelf:'center',flexShrink:0,fontSize:11,fontWeight:800,color:G}}>{row.value}</div>
            </div>
          )) : <div style={{padding:'0 0 16px',fontSize:11.5,color:MU}}>No revenue lines recorded for this month.</div>}

          <div style={{fontFamily:"'Sora',sans-serif",fontSize:14,fontWeight:800,color:INK,margin:'18px 0 10px'}}>Expense Summary</div>
          {details.costRows?.length ? details.costRows.map((row, index) => (
            <div key={`cost-${row.title}-${index}`} style={{padding:'12px 0',borderBottom:index < details.costRows.length - 1 ? `1px solid ${BD2}` : 'none',display:'flex',justifyContent:'space-between',gap:12}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:12.5,fontWeight:800,color:INK,marginBottom:4}}>{row.title}</div>
                <div style={{fontSize:11,color:MU,lineHeight:1.45}}>{row.meta}</div>
              </div>
              <div style={{alignSelf:'center',flexShrink:0,fontSize:11,fontWeight:800,color:CR}}>{formatPaise(row.amountPaise || 0)}</div>
            </div>
          )) : <div style={{padding:'0 0 16px',fontSize:11.5,color:MU}}>No expense lines recorded for this month.</div>}

          {details.footer && <div style={{marginTop:14,padding:'12px 14px',borderRadius:14,background:GLt,fontSize:11.5,fontWeight:700,color:G}}>{details.footer}</div>}
        </div>
      </div>
    </div>
  );
}

/* ── Quick Action Modal ── */
function ActionModal({ item, type, trips = [], onClose, onDeleteSuccess }) {
  const [activeTab, setActiveTab] = React.useState('actions');
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  if (!item) return null;
  const isTruck = type === 'truck';
  const accent = isTruck ? S : G;
  const accentLt = isTruck ? SLt2 : GLt2;

  const executeDelete = async () => {
    setDeleting(true);
    try {
      const idToUse = isTruck ? item.real_db_id : item.id;
      const res = await fetch(`${window.FLEETOS_API_BASE || ''}/api/${isTruck ? 'fleet' : 'drivers'}/${idToUse}`, { 
        method: 'DELETE',
        headers: getApiHeaders()
      });
      if (res.ok) {
        onDeleteSuccess(type, item.id);
        onClose();
      } else {
        setDeleting(false);
        setConfirmDelete(false);
      }
    } catch (err) {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const getDocPath = (key) => {
    const p = item[`doc_${key.toLowerCase()}_path`];
    if (!p) return '#';
    if (p.startsWith('http')) return p;
    
    // Extract filename and suggest a friendly name
    const filename = encodeURIComponent(p.split('/').pop());
    const friendlyPrefix = (isTruck ? item.id : item.name).replace(/[^a-z0-9]/gi, '_');
    const suggestName = encodeURIComponent(`${friendlyPrefix}_${key}`);
    
    const baseUrl = window.FLEETOS_API_BASE || '';
    const token = localStorage.getItem('fleetToken');
    return `${baseUrl}/api/download/${filename}?name=${suggestName}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  };

  const docs = isTruck 
    ? [
        { name: 'RC Book', key: 'RC' },
        { name: 'Insurance', key: 'Insurance' },
        { name: 'Fitness', key: 'Fitness' },
        { name: 'PUC', key: 'PUC' },
        { name: 'Permit', key: 'Permit' },
        { name: 'Road Tax', key: 'RoadTax' }
      ]
    : [
        { name: 'Driving License', key: 'DL' },
        { name: 'Aadhaar Card', key: 'Aadhar' },
        { name: 'PAN Card', key: 'PAN' }
      ];

  const label = isTruck ? formatRegNo(item.id) : item.name;
  const formatDriverValue = (value, formatter = null) => {
    if (value === undefined || value === null) return "---";
    const text = String(value).trim();
    if (!text) return "---";
    return formatter ? formatter(text) : text;
  };
  const formatDriverPhone = (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length === 10) return `+91 ${digits}`;
    if (digits.length === 12 && digits.startsWith("91")) return `+${digits.slice(0, 2)} ${digits.slice(2)}`;
    return String(value || "").trim() || "---";
  };
  const formatDriverDate = (value) => {
    const parsed = parseFlexibleDate(value);
    return parsed ? formatDateLabel(parsed) : (String(value || "").trim() || "---");
  };
  const driverInfoRows = !isTruck ? [
    { label: "Mobile", value: formatDriverValue(item.phone, formatDriverPhone) },
    { label: "Date of Birth", value: formatDriverValue(item.dob, formatDriverDate) },
    { label: "Blood Group", value: formatDriverValue(item.bloodGroup) },
    { label: "Home City", value: formatDriverValue(item.city) },
    { label: "Employment", value: formatDriverValue(item.empType) }
  ] : [];
  const driverLicenseRows = !isTruck ? [
    { label: "DL Number", value: formatDriverValue(item.dlNo) },
    { label: "License Type", value: formatDriverValue(item.licenseType || item.vehicleCategory) },
    { label: "DL Expiry", value: formatDriverValue(item.dlExpiry, formatDriverDate) },
    { label: "Aadhaar", value: formatDriverValue(item.aadhar) },
    { label: "PAN", value: formatDriverValue(item.pan) }
  ] : [];
  const driverCompletedTrips = !isTruck
    ? (trips || [])
        .filter((trip) =>
          String(trip.driver || '').trim().toLowerCase() === String(item.name || '').trim().toLowerCase() &&
          String(trip.status || '').toLowerCase() === 'completed'
        )
        .sort((a, b) => (getTripTime(b, ["endDateRaw", "autoEndDateRaw", "startDateRaw"]) || 0) - (getTripTime(a, ["endDateRaw", "autoEndDateRaw", "startDateRaw"]) || 0))
    : [];
  const driverTotalKm = driverCompletedTrips.reduce((sum, trip) => sum + Number(trip.distanceKm || trip.distance_km || trip.km || 0), 0);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(26, 24, 20, 0.7)', 
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', zIndex: 100000, 
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      animation: 'simFadeIn 0.3s ease'
    }} onClick={onClose}>
      <div style={{
        background: WH, borderRadius: 28, width: '100%', maxWidth: 320, 
        overflow: 'hidden', boxShadow: '0 25px 60px rgba(0,0,0,0.4)',
        transform: 'translateY(0)', animation: 'simSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        border: `1px solid ${BD}`, position: 'relative'
      }} onClick={e => e.stopPropagation()}>
        
        {confirmDelete ? (
          <div style={{ padding: 28, textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', background: '#fff5f5',
              margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, border: `2px solid ${CR}22`
            }}>🚨</div>
            <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 900, fontSize: 20, color: INK, marginBottom: 8 }}>
              Delete {label}?
            </div>
            <div style={{ fontSize: 12, color: MU, marginBottom: 24, lineHeight: 1.5, padding: '0 8px' }}>
              This will <strong style={{color: CR}}>permanently remove</strong> this {isTruck ? 'truck' : 'driver'} and all associated records from the database. This action cannot be undone.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <button
                onClick={executeDelete}
                disabled={deleting}
                style={{
                  padding: '14px', borderRadius: 14, border: 'none', background: CR,
                  color: WH, fontWeight: 800, fontSize: 13, cursor: deleting ? 'wait' : 'pointer',
                  opacity: deleting ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  fontFamily: "'DM Sans',sans-serif"
                }}>
                {deleting ? '⏳ Deleting...' : '🗑️ Yes, Permanently Delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                style={{
                  padding: '14px', borderRadius: 14, border: `1.5px solid ${BD}`, background: 'transparent',
                  color: MU, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  fontFamily: "'DM Sans',sans-serif"
                }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ 
              display: 'flex', borderBottom: `1px solid ${BG}`, padding: '0 20px' 
            }}>
              <div 
                onClick={() => setActiveTab('actions')}
                style={{ 
                  padding: '16px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  color: activeTab === 'actions' ? accent : MU,
                  borderBottom: activeTab === 'actions' ? `2px solid ${accent}` : 'none'
                }}>Actions</div>
              {!isTruck && (
                <div 
                  onClick={() => setActiveTab('trips')}
                  style={{ 
                    padding: '16px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    color: activeTab === 'trips' ? accent : MU,
                    borderBottom: activeTab === 'trips' ? `2px solid ${accent}` : 'none'
                  }}>Trips</div>
              )}
              <div 
                onClick={() => setActiveTab('documents')}
                style={{ 
                  padding: '16px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  color: activeTab === 'documents' ? accent : MU,
                  borderBottom: activeTab === 'documents' ? `2px solid ${accent}` : 'none'
                }}>Documents</div>
            </div>

            {activeTab === 'actions' ? (
              <div style={{ padding: 28, textAlign: 'center' }}>
                <div style={{ 
                  width: 72, height: 72, borderRadius: 20, background: accentLt,
                  margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 36, boxShadow: `0 8px 20px ${accent}22`
                }}>
                  {isTruck ? '🚛' : '👤'}
                </div>
                <div style={{ fontFamily: "'Sora',sans-serif", fontWeight: 900, fontSize: 24, color: INK, marginBottom: 4, letterSpacing: -0.5 }}>
                  {isTruck ? formatRegNo(item.id) : item.name}
                </div>
                <div style={{ fontSize: 13, color: MU, marginBottom: 20, fontWeight: 500 }}>
                  {isTruck ? `${item.type} · ${item.driver}` : `${item.empType} · ID: ${item.id}`}
                </div>
                {!isTruck && (
                  <div style={{ fontSize: 12, color: G, marginTop: -10, marginBottom: 20, fontWeight: 800 }}>
                    Kms Done: {formatIndianNumber(Math.round(driverTotalKm))} km
                  </div>
                )}
                
                {!isTruck && item.temp_password && (
                  <div style={{ 
                    background: GLt2, borderRadius: 16, padding: '14px 20px', marginBottom: 28,
                    border: `1.5px dashed ${G}`, display: 'flex', flexDirection: 'column', gap: 4
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: G, textTransform: 'uppercase', letterSpacing: 1 }}>Driver Initial PIN (OTP)</div>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 24, fontWeight: 900, color: G, letterSpacing: 4 }}>
                      {item.temp_password}
                    </div>
                    <div style={{ fontSize: 9, color: MU, fontWeight: 600 }}>Share this with the driver for their first login</div>
                  </div>
                )}
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                  <button 
                    onClick={() => {
                      const idToUse = isTruck ? item.real_db_id : item.id;
                      const path = isTruck ? 'Fleetos%20Add%20Truck' : 'Fleetos%20Add%20Driver';
                      navigateToAppPage(`${path}.html`, { id: idToUse, edit: 'true' });
                    }}
                    style={{
                      padding: '15px', borderRadius: 16, border: 'none', background: G, 
                      color: WH, fontWeight: 800, fontSize: 13, cursor: 'pointer',
                      boxShadow: `0 6px 15px ${G}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                    }}>
                    <span style={{ fontSize: 16 }}>✏️</span> Edit Record
                  </button>
                  <button 
                    onClick={() => setConfirmDelete(true)}
                    style={{
                      padding: '15px', borderRadius: 16, border: `1.5px solid ${CR}`, background: 'transparent', 
                      color: CR, fontWeight: 800, fontSize: 13, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                    }}>
                    <span style={{ fontSize: 16 }}>🗑️</span> Delete Entry
                  </button>
                </div>
              </div>
            ) : activeTab === 'trips' ? (
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: INK, marginBottom: 8 }}>Completed Trips</div>
                <div style={{ fontSize: 11, color: MU, marginBottom: 14 }}>
                  {driverCompletedTrips.length} completed trip{driverCompletedTrips.length === 1 ? '' : 's'} · {formatIndianNumber(Math.round(driverTotalKm))} km total
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 360, overflowY: 'auto' }} className="no-scrollbar">
                  {driverCompletedTrips.length ? driverCompletedTrips.map((trip) => (
                    <div key={trip.id} style={{ background: BG, border: `1px solid ${BD}`, borderRadius: 14, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>{formatRouteLabel(trip.route, trip.dest)}</div>
                          <div style={{ fontSize: 10.5, color: MU, marginTop: 4 }}>
                            {[trip.id, trip.endDate || trip.end_date || trip.endDateRaw || trip.startDate].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 900, color: G }}>{formatIndianNumber(Math.round(Number(trip.distanceKm || trip.distance_km || trip.km || 0)))} km</div>
                          <div style={{ fontSize: 10.5, color: MU, marginTop: 4 }}>{formatRupees(Math.round(Number(trip.earned || getTripFreightRupees(trip) || 0)))}</div>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div style={{ background: BG, border: `1px solid ${BD}`, borderRadius: 14, padding: '18px 14px', fontSize: 11.5, color: MU, textAlign: 'center' }}>
                      No completed trips recorded for this driver yet.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ padding: 20 }}>
                {!isTruck && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, background: WH, border: `1px solid ${BD}`, borderRadius: 16, overflow: 'hidden', marginBottom: 18 }}>
                      {driverInfoRows.map((row, index) => (
                        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderBottom: index < driverInfoRows.length - 1 ? `1px solid ${BD2}` : 'none' }}>
                          <div style={{ fontSize: 12, color: MU, fontWeight: 700 }}>{row.label}</div>
                          <div style={{ fontSize: 12.5, color: INK, fontWeight: 700, textAlign: 'right', maxWidth: '60%' }}>{row.value}</div>
                        </div>
                      ))}
                    </div>

                    <div style={{ fontSize: 14, fontWeight: 800, color: INK, marginBottom: 10 }}>License Details</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, background: WH, border: `1px solid ${BD}`, borderRadius: 16, overflow: 'hidden', marginBottom: 18 }}>
                      {driverLicenseRows.map((row, index) => (
                        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderBottom: index < driverLicenseRows.length - 1 ? `1px solid ${BD2}` : 'none' }}>
                          <div style={{ fontSize: 12, color: MU, fontWeight: 700 }}>{row.label}</div>
                          <div style={{ fontSize: 12.5, color: INK, fontWeight: 700, textAlign: 'right', maxWidth: '60%' }}>{row.value}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {docs.map(doc => {
                    const path = item[`doc_${doc.key.toLowerCase()}_path`];
                    const isImg = path && !path.toLowerCase().endsWith('.pdf');
                    const downloadUrl = getDocPath(doc.key);

                    return (
                      <div key={doc.key} style={{ 
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 14px', borderRadius: 12, background: BG, border: `1px solid ${BD}`
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          {isImg ? (
                            <img src={downloadUrl} style={{width:40, height:40, borderRadius:6, objectFit:'cover', border:`1px solid ${BD2}`, background:WH}} 
                                 onError={(e)=>e.target.style.display='none'} />
                          ) : (
                            <div style={{ fontSize: 18 }}>📄</div>
                          )}
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{doc.name}</div>
                            {path ? <div style={{ fontSize: 9, color: G, fontWeight: 700 }}>Available ✓</div> : <div style={{ fontSize: 9, color: MU2 }}>Missing ×</div>}
                          </div>
                        </div>
                        <a 
                          href={downloadUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ 
                            fontSize: 11, fontWeight: 800, color: path ? accent : MU2, textDecoration: 'none',
                            padding: '6px 10px', borderRadius: 8, background: WH, border: `1px solid ${path ? accent : BD}44`,
                            pointerEvents: path ? 'auto' : 'none'
                          }}>
                          {path ? 'View' : 'None'}
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <style>{`
        @keyframes simFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes simSlideUp { from { transform: translateY(50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        html, body { height: 100% !important; width: 100% !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: #f5f2ec !important; }
      `}</style>
    </div>
  );
}

/* ── Trip Detail & Complete Modal ── */
function TripDetailModal({ trip, type, onClose, onRefresh }) {
  const [completeDate, setCompleteDate] = useState(new Date().toISOString().split('T')[0]);
  const [localExpenses, setLocalExpenses] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expenseSectionOpen, setExpenseSectionOpen] = useState(false);
  const [expenseGroupOpen, setExpenseGroupOpen] = useState({});
  const [calcInfoOpen, setCalcInfoOpen] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState(null);
  const allTrips = window.__FLEET_TRIPS__ || [];

  useEffect(() => {
    if (trip) {
      setLoading(true);
      setExpenseGroupOpen({});
      fetch(`${window.FLEETOS_API_BASE || ''}/api/fleet/trips/${trip.id}/expenses`, {
        headers: getApiHeaders()
      })
        .then(r => r.json())
        .then(data => {
            setLocalExpenses(data);
            setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [trip]);

  useEffect(() => {
    if (type === 'complete') {
        const timeoutId = setTimeout(() => {
            if (window.attachFleetOSDatePicker) {
                window.attachFleetOSDatePicker("tripCompleteDate");
                if (window.setFleetOSDatePickerValue && completeDate) {
                  window.setFleetOSDatePickerValue("tripCompleteDate", completeDate);
                }
                const hiddenInput = document.getElementById("tripCompleteDate");
                if (hiddenInput) {
                    const syncValue = () => {
                      if (hiddenInput.value) setCompleteDate(hiddenInput.value);
                    };
                    hiddenInput.addEventListener('change', syncValue);
                    hiddenInput.addEventListener('input', syncValue);
                    hiddenInput.__tripCompleteCleanup = () => {
                      hiddenInput.removeEventListener('change', syncValue);
                      hiddenInput.removeEventListener('input', syncValue);
                    };
                }
            }
        }, 100);
        return () => {
          clearTimeout(timeoutId);
          const hiddenInput = document.getElementById("tripCompleteDate");
          if (hiddenInput?.__tripCompleteCleanup) {
            hiddenInput.__tripCompleteCleanup();
            delete hiddenInput.__tripCompleteCleanup;
          }
        };
    }
  }, [type]);

  if (!trip) return null;

  const parseDt = (d) => d ? new Date(d) : new Date();
  const start = parseDt(trip.startDateRaw);
  const end = type === 'complete' || trip.status === 'Completed' ? parseDt(completeDate || trip.endDateRaw) : new Date();
  
  const dayMetrics = computeTripOperationalDays({
    ...trip,
    endDateRaw: type === 'complete' ? (completeDate || trip.endDateRaw) : trip.endDateRaw
  }, allTrips);
  const runningDays = dayMetrics.actualDays;
  const bhattaTotal = runningDays * (trip.bhatta || 0);
  const depreciationDays = dayMetrics.depreciationDays;
  const depreciationExpense = ((Number(trip.truckPurchasePrice || 0) / (365 * 7)) * depreciationDays) || 0;
  const wearAndTearExpense = ((((Number(trip.truckTyresCount || 0) * 25000) / 60000) * Number(trip.distanceKm || 0)) || 0);
  const sortedExpenses = [...localExpenses].sort((a, b) => new Date(a.date || a.created_at || 0) - new Date(b.date || b.created_at || 0));

  const getExpenseAmountRupees = (expense) => {
    if (Number(expense?.total_rupees || 0) > 0) return Number(expense.total_rupees || 0);
    if (Number(expense?.total_paise || 0) > 0) return Number(expense.total_paise || 0) / 100;
    return Number(expense?.amount || 0);
  };

  const totalLedgerCosts = Array.isArray(localExpenses) ? localExpenses.reduce((acc, curr) => acc + getExpenseAmountRupees(curr), 0) : 0;
  const calculatedOtherCosts = bhattaTotal + depreciationExpense + wearAndTearExpense;
  const totalCosts = calculatedOtherCosts + totalLedgerCosts;
  const livePnl = (trip.freight || 0) - totalCosts;
  const normalizedTripExpenseRows = [
    ...sortedExpenses,
    ...(bhattaTotal > 0 ? [{
      id: `calc-bhatta-${trip.id}`,
      expense_type: 'Driver Bhatta',
      category: 'Driver Bhatta',
      merchant: 'Driver Bhatta',
      notes: 'Calculated from trip days',
      place: formatRouteLabel(trip.route, trip.dest),
      date: completeDate || trip.endDateRaw || trip.autoEndDateRaw || trip.startDateRaw,
      total_rupees: bhattaTotal,
      total_paise: Math.round(bhattaTotal * 100)
    }] : []),
    ...((depreciationExpense + wearAndTearExpense) > 0 ? [{
      id: `calc-depr-${trip.id}`,
      expense_type: 'Depreciation',
      category: 'Depreciation',
      merchant: 'Depreciation',
      notes: 'Depreciation and wear & tear',
      place: formatRouteLabel(trip.route, trip.dest),
      date: completeDate || trip.endDateRaw || trip.autoEndDateRaw || trip.startDateRaw,
      total_rupees: depreciationExpense + wearAndTearExpense,
      total_paise: Math.round((depreciationExpense + wearAndTearExpense) * 100)
    }] : [])
  ];
  const expenseGroups = ["Fuel Expense", "Depreciation", "Driver Bhatta", "Urea", "Others"].map((label) => {
    const rows = normalizedTripExpenseRows.filter((expense) => classifyTripExpenseCategory(expense) === label);
    return {
      label,
      rows,
      total: rows.reduce((sum, expense) => sum + getExpenseAmountRupees(expense), 0)
    };
  });

  const getFuelQuantityLitres = (expense) => {
    const metadata = expense?.metadata || {};
    const candidates = [
      metadata.litres,
      metadata.liters,
      metadata.fuelLitres,
      metadata.fuel_litres,
      metadata.quantity,
      metadata.qty,
      metadata.volume,
      metadata.totalLitres,
      metadata.total_litres
    ];
    const first = candidates.find((value) => value !== undefined && value !== null && value !== "");
    const parsed = Number(first);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const expenseCalcMap = {
    bhatta: {
      title: "Driver Bhatta",
      body: `Calculated as daily bhatta multiplied by running days for this trip.\n\n₹${Number(trip.bhatta || 0).toLocaleString("en-IN")}/day × ${runningDays} day${runningDays === 1 ? "" : "s"} = ${formatRupees(Math.round(bhattaTotal))}`
    },
    depreciation: {
      title: "Depreciation",
      body: `Calculated on straight-line basis over 7 years using truck purchase price.\n\n₹${Math.round(Number(trip.truckPurchasePrice || 0)).toLocaleString("en-IN")} ÷ (365 × 7) × ${depreciationDays} asset day${depreciationDays === 1 ? "" : "s"} = ${formatRupees(Math.round(depreciationExpense))}`
    },
    wear: {
      title: "Wear & Tear",
      body: `Calculated using tyre replacement cost spread over 60,000 km.\n\n(${Number(trip.truckTyresCount || 0)} tyres × ₹25,000 ÷ 60,000) × ${Number(trip.distanceKm || 0).toLocaleString("en-IN")} km = ${formatRupees(Math.round(wearAndTearExpense))}`
    }
  };

  const handleUpdateTrip = async () => {
    setSaving(true);
    try {
        if (type === 'complete') {
            const prettyDate = new Date(completeDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
            await fetch(`${window.FLEETOS_API_BASE || ''}/api/fleet/trips/${trip.id}`, {
                method: 'PUT',
                headers: { ...getApiHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'Completed', endDate: prettyDate, endDateRaw: completeDate })
            });
        }
        onRefresh();
        onClose();
    } catch (err) {
        alert("Operation failed");
    } finally {
        setSaving(false);
    }
  };

  const addRow = async () => {
    try {
        const res = await fetch(`${window.FLEETOS_API_BASE || ''}/api/expenses`, {
            method: 'POST',
            headers: { ...getApiHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'Fuel', amount: 0, tripId: trip.id, notes: '', date: new Date().toISOString().split('T')[0] })
        });
        const data = await res.json();
        setLocalExpenses([...localExpenses, { id: data.id, type: 'Fuel', amount: 0, notes: '' }]);
    } catch (e) { alert("Failed to add expense"); }
  };

  const updateRow = async (id, field, val) => {
    const item = localExpenses.find(i => i.id === id);
    if (!item) return;
    try {
        await fetch(`${window.FLEETOS_API_BASE || ''}/api/expenses/${id}`, {
            method: 'PUT',
            headers: { ...getApiHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...item, [field]: val })
        });
    } catch (e) { console.error("Auto-save failed"); }
  };

  const removeRow = async (id) => {
    if (!confirm("Remove this cost?")) return;
    try {
        await fetch(`${window.FLEETOS_API_BASE || ''}/api/expenses/${id}`, { method: 'DELETE', headers: getApiHeaders() });
        setLocalExpenses(localExpenses.filter(ex => ex.id !== id));
    } catch (e) { alert("Failed to delete"); }
  };

  return (
    <div style={{position: 'fixed', inset: 0, background: 'rgba(26,92,58,0.12)', backdropFilter: 'blur(20px)', zIndex: 100001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16}} onClick={onClose}>
      <div style={{background: WH, borderRadius: 32, width: '100%', maxWidth: 400, maxHeight: '85vh', position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: `1.5px solid ${BD}`, boxShadow: '0 25px 50px -12px rgba(26,92,58,0.25)'}} onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div style={{padding: '28px 24px 20px', background: `linear-gradient(135deg, ${WH} 0%, ${BG} 100%)`}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12}}>
                <div>
                   <div style={{fontSize: 10, fontWeight: 900, color: GO, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4}}>{trip.id}</div>
                   <div style={{fontFamily: "'Sora',sans-serif", fontWeight: 900, fontSize: 24, color: INK, letterSpacing: -0.5}}>{formatRegNo(trip.truck)}</div>
                </div>
                <div onClick={onClose} style={{width: 36, height: 36, borderRadius: 12, background: WH, border: `1px solid ${BD}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16}}>✕</div>
            </div>
            <div style={{fontSize: 14, fontWeight: 700, color: MU, display: 'flex', alignItems: 'center', gap: 8}}>
                <span style={{fontSize: 16}}>📍</span> {cleanLoc(trip.route)} → {cleanLoc(trip.dest)}
            </div>
        </div>

        <div style={{flex: 1, overflowY: 'auto', padding: '0 24px 24px'}} className="no-scrollbar">
            
            <div style={{background: GLt2, borderRadius: 24, padding: 20, marginBottom: 28, border: `1px solid ${G}15`, boxShadow: `0 10px 20px ${G}08`}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:12, paddingBottom: 12, borderBottom: `1px solid ${G}22`}}>
                    <div>
                        <div style={{fontSize: 9, fontWeight: 800, color: G, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4}}>Driver in Charge</div>
                        <div style={{fontSize: 18, fontWeight: 900, color: INK}}>{trip.driver || 'N/A'}</div>
                    </div>
                    <div style={{textAlign: 'right'}}>
                        <div style={{fontSize: 9, fontWeight: 800, color: G, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4}}>Trip Date</div>
                        <div style={{fontSize: 14, fontWeight: 800, color: INK, background: WH, padding: '4px 8px', borderRadius: 8, display: 'inline-block'}}>{trip.startDate || 'TBD'}</div>
                    </div>
                </div>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                    <span style={{color: G, fontSize: 11, fontWeight: 800}}>Current Trip Status</span>
                    <StatusChip status={trip.status}/>
                </div>
            </div>

            {type === 'complete' && (
                <div style={{marginBottom: 24}}>
                    <label style={{fontSize: 10, fontWeight: 900, textTransform: 'uppercase', color: GO, display: 'block', marginBottom: 10, letterSpacing: 1}}>Actual Delivery Date</label>
                    <div style={{position: 'relative', background: BG, border: `1.5px solid ${BD}`, borderRadius: 20, padding: '16px 20px', cursor: 'pointer', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'}} id="trigger-tripCompleteDate">
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                            <div style={{fontSize: 15, fontWeight: 800, color: INK}} className="dp-trigger-val">{formatDateLabel(completeDate)}</div>
                            <span style={{fontSize: 20}}>📅</span>
                        </div>
                        <input type="hidden" id="tripCompleteDate" value={completeDate} />
                    </div>
                </div>
            )}

            <div style={{background: WH, borderRadius: 24, padding: 20, marginBottom: 24, border: `1.5px solid ${BD}`, boxShadow: '0 10px 24px rgba(26,24,20,0.06)'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
                    <div style={{fontSize: 10, fontWeight: 900, color: G, textTransform: 'uppercase', letterSpacing: 1.3}}>Live P&amp;L</div>
                    <div style={{fontSize: 12, fontWeight: 800, color: livePnl >= 0 ? G : CR}}>{livePnl >= 0 ? 'Profitable' : 'Loss-making'}</div>
                </div>
                <div style={{display:'flex', flexDirection:'column', gap:10}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', paddingBottom:10, borderBottom:`1px solid ${BD2}`}}>
                        <span style={{fontSize:13.5, fontWeight:800, color:INK}}>Freight Revenue</span>
                        <span style={{fontFamily:"'Sora',sans-serif", fontSize:20, fontWeight:900, color:G}}>{formatRupees(Math.round((trip.freight || 0)))}</span>
                    </div>
                    <div style={{paddingBottom:10, borderBottom:`1px solid ${BD2}`}}>
                        <div onClick={() => setExpenseSectionOpen((open) => !open)} style={{display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer'}}>
                            <span style={{fontSize:13.5, fontWeight:800, color:INK}}>Expenses</span>
                            <div style={{display:'flex', alignItems:'center', gap:10}}>
                                <span style={{fontFamily:"'Sora',sans-serif", fontSize:18, fontWeight:900, color:CR}}>-{formatRupees(Math.round(totalCosts))}</span>
                                <span style={{fontSize:16, color:MU}}>{expenseSectionOpen ? '▴' : '▾'}</span>
                            </div>
                        </div>
                        {expenseSectionOpen && (
                            <div style={{marginTop:12, display:'flex', flexDirection:'column', gap:10}}>
                                {expenseGroups.map((group) => {
                                  const isOpen = !!expenseGroupOpen[group.label];
                                  return (
                                    <div key={group.label} style={{background:BG, border:`1px solid ${BD}`, borderRadius:14, overflow:'hidden'}}>
                                      <div onClick={() => setExpenseGroupOpen((prev) => ({ ...prev, [group.label]: !prev[group.label] }))} style={{padding:'12px 14px', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer'}}>
                                        <div style={{fontSize:12.5, fontWeight:800, color:INK}}>{group.label}</div>
                                        <div style={{display:'flex', alignItems:'center', gap:10}}>
                                          <span style={{fontSize:13.5, fontWeight:900, color:INK}}>{formatRupees(Math.round(group.total))}</span>
                                          <span style={{fontSize:16, color:MU}}>{isOpen ? '▴' : '▾'}</span>
                                        </div>
                                      </div>
                                      {isOpen && (
                                        <div style={{padding:'0 14px 14px', display:'flex', flexDirection:'column', gap:10}}>
                                          {group.rows.length ? group.rows.map((expense) => (
                                            <div key={expense.id} style={{background:WH, border:`1px solid ${BD}`, borderRadius:12, padding:'12px'}}>
                                              <div style={{display:'flex', justifyContent:'space-between', gap:10, alignItems:'flex-start'}}>
                                                <div>
                                                  <div style={{fontSize:12.5, fontWeight:800, color:INK}}>{expense.metadata?.vendor || expense.merchant || expense.notes || group.label}</div>
                                                  <div style={{fontSize:10.5, color:MU, marginTop:4}}>
                                                    {[
                                                      expense.date || expense.created_at || 'No date',
                                                      group.label === 'Fuel Expense' && getFuelQuantityLitres(expense) ? `${getFuelQuantityLitres(expense).toLocaleString("en-IN")} L` : null,
                                                      expense.place || expense.notes || null
                                                    ].filter(Boolean).join(' • ')}
                                                  </div>
                                                </div>
                                                <div style={{textAlign:'right'}}>
                                                  <div style={{fontSize:13, fontWeight:900, color:INK}}>{formatRupees(Math.round(getExpenseAmountRupees(expense)))}</div>
                                                  {expense.bill_image_data && (
                                                    <button onClick={() => setReceiptPreview(expense)} style={{marginTop:8, border:'none', background:GLt2, color:G, borderRadius:10, padding:'6px 10px', fontSize:10.5, fontWeight:800, cursor:'pointer'}}>View Receipt</button>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          )) : (
                                            <div style={{fontSize:11, color:MU, background:WH, border:`1px solid ${BD}`, borderRadius:12, padding:'12px'}}>No entries recorded yet.</div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}

                                <div 
                                    onClick={addRow} 
                                    style={{
                                        background: GLt, border: `2px dashed ${G}44`, borderRadius: 16, 
                                        padding: 12, display: 'flex', alignItems: 'center', 
                                        justifyContent: 'center', gap: 8, cursor: 'pointer', 
                                        color: G, fontWeight: 900, fontSize: 13
                                    }}>
                                    <span style={{fontSize: 18}}>✚</span> Add New Trip Expense
                                </div>
                            </div>
                        )}
                    </div>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                        <span style={{fontSize:13.5, fontWeight:900, color:INK}}>Live P&amp;L</span>
                        <span style={{fontFamily:"'Sora',sans-serif", fontSize:22, fontWeight:900, color:livePnl >= 0 ? G : CR}}>
                          {livePnl >= 0 ? '' : '-'}{formatRupees(Math.round(Math.abs(livePnl)))}
                        </span>
                    </div>
                </div>
            </div>

        </div>

        <div style={{padding: '20px 24px 32px', borderTop: `1px solid ${BD}`, background: WH}}>
            <button 
                onClick={handleUpdateTrip} 
                disabled={saving} 
                style={{
                    width: '100%', padding: 18, borderRadius: 20, border: 'none', 
                    background: G, color: WH, fontWeight: 900, fontSize: 16, 
                    cursor: 'pointer', display: 'flex', alignItems: 'center', 
                    justifyContent: 'center', gap: 10, boxShadow: `0 10px 25px ${G}40`
                }}>
                {saving ? 'Processing...' : type === 'complete' ? 'Confirm & Finish Trip' : 'Close Details'}
            </button>
        </div>
      </div>
      {receiptPreview && (
        <div style={{position:'fixed', inset:0, background:'rgba(26,24,20,0.72)', zIndex:100005, display:'flex', alignItems:'center', justifyContent:'center', padding:18}} onClick={() => setReceiptPreview(null)}>
          <div style={{background:WH, borderRadius:24, width:'100%', maxWidth:360, maxHeight:'86vh', overflow:'hidden', border:`1px solid ${BD}`}} onClick={(e) => e.stopPropagation()}>
            <div style={{padding:'16px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:`1px solid ${BD}`}}>
              <div>
                <div style={{fontSize:14, fontWeight:900, color:INK}}>Fuel Receipt</div>
                <div style={{fontSize:10.5, color:MU, marginTop:4}}>{receiptPreview.date || 'No date'} • {formatRupees(Math.round(getExpenseAmountRupees(receiptPreview)))}</div>
              </div>
              <button onClick={() => setReceiptPreview(null)} style={{border:'none', background:'transparent', fontSize:22, color:MU, cursor:'pointer'}}>×</button>
            </div>
            <div style={{padding:16}}>
              <img src={receiptPreview.bill_image_data} alt="Fuel receipt" style={{width:'100%', borderRadius:18, border:`1px solid ${BD}`, display:'block'}} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Mini sparkline ── */
function Spark({data,color}){
  const max=Math.max(...data),min=Math.min(...data);
  const range=max-min||1;
  const w=60,h=24;
  const pts=data.map((v,i)=>`${Math.round(i*(w/(data.length-1)))},${Math.round(h-(v-min)/range*h)}`).join(" ");
  return(
    <svg viewBox={`0 0 ${w} ${h}`} style={{width:60,height:24,overflow:"visible"}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round"/>
    </svg>
  );
}

/* ── Trip Card ── */
function TripCard({trip:t, compact=false, onComplete, onViewDetails}){
  const isDelayed = t.status.toLowerCase() === 'delayed' || (t.status.toLowerCase() === 'active' && t.autoEndDateRaw && new Date() > new Date(t.autoEndDateRaw));
  const accent = t.status.toLowerCase() === 'completed' ? BL : (isDelayed ? CR : G);
  
  return(
    <Card style={{position:'relative', borderLeft: `6px solid ${accent}`, cursor: onViewDetails ? 'pointer' : 'default'}} onClick={() => onViewDetails && onViewDetails(t)}>
      <div style={{padding:"14px 16px"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:compact ? 0 : 8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:5,flexWrap:"wrap"}}>
              <span style={{background:INK,color:WH,fontFamily:"'JetBrains Mono',monospace",
                fontSize:10,padding:"3px 8px",borderRadius:5,fontWeight:600,flexShrink:0}}>
                {formatRegNo(t.truck)}
              </span>
              <StatusChip status={isDelayed && t.status.toLowerCase() === 'active' ? 'delayed' : t.status.toLowerCase()}/>
            </div>
            <div style={{fontSize:14,fontWeight:800,color:INK}}>
              {cleanLoc(t.route)} <span style={{color:MU2,fontWeight:400}}> → </span>{cleanLoc(t.dest)}
            </div>
            {!compact && <div style={{fontSize:11,color:MU,marginTop:2}}>Started: {t.startDate || 'TBD'}</div>}
          </div>
          <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
            <div style={{fontSize:9,color:MU2,fontWeight:700,textTransform:'uppercase',marginBottom:2}}>Driver</div>
            <div style={{fontSize:12, fontWeight:800, color:G, background:GLt2, padding:"4px 10px", borderRadius:6}}>{t.driver || "N/A"}</div>
          </div>
        </div>
        {!compact&&(
          <>
            <div style={{display:"flex",gap:8,marginTop:12}}>
              <button 
                onClick={(e) => { e.stopPropagation(); window.location.href=`tel:${t.driverPhone || '9999999999'}`; }}
                style={{flex:1,padding:"10px",borderRadius:10,border:`1.5px solid ${BD}`,
                background:BG,color:INK2,fontSize:11.5,fontWeight:800,cursor:"pointer",
                fontFamily:"'DM Sans',sans-serif", display:'flex', alignItems:'center', justifyContent:'center', gap:6}}>
                <span style={{fontSize:14}}>📞</span> Call
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); onViewDetails(t); }}
                style={{flex:1,padding:"10px",borderRadius:10,border:`1.5px solid ${accent}`,
                background:WH,color:accent,fontSize:11.5,fontWeight:800,cursor:"pointer",
                fontFamily:"'DM Sans',sans-serif"}}>View Details</button>
            </div>
            
            {t.status.toLowerCase() !== 'completed' && (
                <button 
                    onClick={(e) => { e.stopPropagation(); onComplete(t); }}
                    style={{width:'100%', marginTop:10, padding:'12px', borderRadius:10, border:'none', background:INK, color:WH, fontSize:12, fontWeight:800, cursor:'pointer', letterSpacing:0.5}}>
                    🏁 COMPLETE TRIP
                </button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/* ══════════════════ PAGES ══════════════════ */

/* ── Dashboard ── */
/* ── Dashboard ── */
/* ── Dashboard ── */
function DashboardPage({onNavigate, stats, charts, trips, trucks, invoices, ledger, onViewDetails, onViewMap}){
  const tickerRef=useRef(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [revenueMonth, setRevenueMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  useEffect(()=>{
    let x=0;
    const id=setInterval(()=>{
      x-=0.7;
      if(tickerRef.current){
        const w=tickerRef.current.scrollWidth/2;
        if(Math.abs(x)>=w) x=0;
        tickerRef.current.style.transform=`translateX(${x}px)`;
      }
    },16);
    return()=>clearInterval(id);
  },[]);

  const activeAlerts = [
    { text: "System Online • No active incidents " },
    { text: "Checking Fleet Status • Global Sync Active " }
  ];
  const rawChartPoints = buildRevenueCostChartPoints(charts.revenueVsCost || []);
  const chartPoints = buildCorrectedDashboardSeries(trips, ledger, rawChartPoints);
  const revenueExpenseSlides = buildRevenueExpenseSlides(chartPoints);
  const selectedRevenuePoint = chartPoints.find((point) => point.key === revenueMonth) || null;
  const breakdowns = buildDashboardBreakdowns({ trips, trucks, invoices, ledger, revenueMonth, selectedRevenuePoint });
  const revenueSpark = chartPoints.map((point) => Number(point?.r || 0)).slice(-6);
  const costSpark = chartPoints.map((point) => Number(point?.c || 0)).slice(-6);
  const tripSpark = buildRecentCountSpark(trips, (trip) => trip?.startDateRaw || trip?.startDate || trip?.created_at, 6);
  const invoiceSpark = buildRecentCountSpark(invoices, (invoice) => invoice?.date, 6);
  const fleetSpark = buildRecentCountSpark(trips, (trip) => trip?.endDateRaw || trip?.autoEndDateRaw || trip?.startDateRaw, 6);
  const kpis = [
    {key:"revenue",label:"Monthly Revenue",value: formatRupees(stats.totalRevenue || 0),color:G,tag:"Live Data",tC:G,tB:GLt2,spark:revenueSpark.length ? revenueSpark : [0,0,0,0,0,0]},
    {key:"trips",label:"Active Trips",value:formatIndianNumber(stats.activeTrips || stats.tripsCount || 0, { useDotForThousands: true }),color:INK,tag:"Real-time Sync",tC:BL,tB:BLLt,spark:tripSpark.length ? tripSpark : [0,0,0,0,0,0]},
    {key:"fleet",label:"Fleet Utility",value:`${formatIndianNumber(stats.fleetUtilization || 0, { useDotForThousands: true })}%`,color:CR,tag:"System Healthy",tC:G,tB:GLt2,spark:fleetSpark.length ? fleetSpark : [0,0,0,0,0,0]},
    {key:"invoices",label:"Invoices",value:formatIndianNumber(stats.pendingInvoices || 0, { useDotForThousands: true }),color:S,tag:"Pending Review",tC:S,tB:SLt,spark:invoiceSpark.length ? invoiceSpark : (costSpark.length ? costSpark : [0,0,0,0,0,0])},
  ];

  return(
    <div style={{paddingBottom:16}}>
      <div style={{background:S,color:WH,padding:"9px 0",overflow:"hidden",
        display:"flex",alignItems:"center",gap:0}}>
        <div style={{background:"rgba(0,0,0,0.15)",padding:"0 12px",fontSize:10,
          fontWeight:800,letterSpacing:1,flexShrink:0,alignSelf:"stretch",
          display:"flex",alignItems:"center",whiteSpace:"nowrap"}}>⚡ LIVE</div>
        <div style={{overflow:"hidden",flex:1}}>
          <div ref={tickerRef} style={{display:"flex",whiteSpace:"nowrap",willChange:"transform"}}>
            {[0,1].map(k=>(
              <span key={k} style={{display:"inline-flex",gap:24,padding:"0 20px",fontSize:10.5,fontWeight:600}}>
                {activeAlerts.map((a,i) => <span key={i}>{a.text}</span>)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{padding:MOBILE_DENSE?"12px 12px 0":"16px 16px 0"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:MOBILE_DENSE?6:8,marginBottom:MOBILE_DENSE?12:16}}>
          {kpis.map((k,i)=>(
            <div key={i} onClick={() => setSelectedDetail(k.key)} style={{background:WH,border:`1px solid ${BD}`,borderRadius:12,
              padding:MOBILE_DENSE?"11px 12px":"14px 16px",boxShadow:"0 1px 4px rgba(26,24,20,0.06)",minHeight:MOBILE_DENSE?88:108,cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{fontSize:MOBILE_DENSE?8:9,fontWeight:700,letterSpacing:1.1,textTransform:"uppercase",color:MU,lineHeight:1.25,maxWidth:'70%'}}>{k.label}</div>
                <Spark data={k.spark} color={k.color}/>
              </div>
              <div style={{fontFamily:"'Sora',sans-serif",fontWeight:900,fontSize:MOBILE_DENSE?20:24,color:k.color,
                letterSpacing:-1,lineHeight:1,margin:MOBILE_DENSE?"5px 0":"6px 0"}}>
                {k.value}
              </div>
              <Tag color={k.tC} bg={k.tB} style={{fontSize:MOBILE_DENSE?8.5:9.5,padding:MOBILE_DENSE?"3px 7px":"3px 8px"}}>{k.tag}</Tag>
            </div>
          ))}
        </div>

        <Card style={{marginBottom:MOBILE_DENSE?8:10}}>
          <div style={{padding:MOBILE_DENSE?"12px":"16px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:MOBILE_DENSE?4:6}}>
              <div>
                <div style={{fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:MOBILE_DENSE?13:14,color:INK}}>
                  Revenue vs Expenses
                </div>
                <div style={{fontSize:MOBILE_DENSE?8.5:9.5,color:MU}}>Swipe by half-year batch · tap any month for full P&amp;L</div>
              </div>
              <div style={{display:"flex",gap:MOBILE_DENSE?6:10}}>
                {[[G,"Revenue"],[S,"Expenses"]].map(([bg,lbl],j)=>(
                  <div key={j} style={{display:"flex",alignItems:"center",gap:4,fontSize:MOBILE_DENSE?8.5:9.5,color:MU}}>
                    <div style={{width:8,height:8,background:bg,borderRadius:2}}/>
                    {lbl}
                  </div>
                ))}
              </div>
            </div>
            <RevenueExpenseCarousel
              slides={revenueExpenseSlides}
              selectedKey={revenueMonth}
              onSelectMonth={(point) => {
                setRevenueMonth(point.key);
                setSelectedDetail("monthPerformance");
              }}
            />
          </div>
        </Card>

        <Card style={{marginBottom:MOBILE_DENSE?12:16}}>
          <div onClick={() => setSelectedDetail("costs")} style={{padding:MOBILE_DENSE?"12px":"16px",cursor:"pointer"}}>
            <div style={{fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:MOBILE_DENSE?13:14,color:INK,marginBottom:3}}>Cost Breakdown</div>
            <div style={{fontSize:MOBILE_DENSE?8.5:9.5,color:MU,marginBottom:MOBILE_DENSE?10:14}}>This month's expense split by operating bucket</div>
            <CostBreakdownBars rows={breakdowns.costs.chartRows || []} />
          </div>
        </Card>

        <SecHd left={<>Recent <em style={{fontStyle:"italic",color:G}}>Trips</em></>}
          action="View All →" onAction={()=>onNavigate("trips")}/>
        <div style={{display:"flex",flexDirection:"column",gap:MOBILE_DENSE?6:8}}>
          {trips.length > 0 ? trips.slice(0,3).map(t=><TripCard key={t.id} trip={t} compact onViewDetails={onViewDetails}/>) : (
            <div style={{padding:20, textAlign:'center', color:MU, background:WH, borderRadius:12, border:`1px solid ${BD}`}}>No active trips found.</div>
          )}
        </div>

        {/* PRE-FETCH HINT */}
        <iframe src="Fleetos Add Truck.html" style={{display:'none', width:0, height:0, border:0}}></iframe>
        <iframe src="Fleetos Add Driver.html" style={{display:'none', width:0, height:0, border:0}}></iframe>

        <div style={{marginTop:MOBILE_DENSE?12:16, paddingBottom:MOBILE_DENSE?12:20}}>
          <SecHd left={<>Fleet <em style={{fontStyle:"italic",color:G}}>Live Map</em></>}/>
          <LiveFleetMapCard trips={trips} onOpen={onViewMap} />
        </div>
      </div>

      {selectedDetail && selectedDetail === "costs" && (
        <CostBreakdownDetailSheet
          title={breakdowns.costs.title}
          subtitle={breakdowns.costs.subtitle}
          rows={breakdowns.costs.detailRows || []}
          summary={breakdowns.costs.summary}
          footer={breakdowns.costs.footer}
          onClose={() => setSelectedDetail(null)}
        />
      )}
      {selectedDetail === "monthPerformance" && (
        <MonthlyPerformanceDetailSheet
          details={breakdowns.monthlyPerformance}
          onClose={() => setSelectedDetail(null)}
        />
      )}
      {selectedDetail && selectedDetail !== "costs" && selectedDetail !== "monthPerformance" && (
        <DetailSheet
          {...breakdowns[selectedDetail]}
          controls={selectedDetail === "revenue" ? (
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <label style={{fontSize:10,fontWeight:800,color:MU,textTransform:"uppercase",letterSpacing:0.8}}>Period</label>
              <input
                type="month"
                value={revenueMonth}
                onChange={(e) => setRevenueMonth(e.target.value)}
                aria-label="Revenue period"
                style={{
                  flex:1,
                  border:`1px solid ${BD}`,
                  background:BG,
                  color:INK,
                  borderRadius:10,
                  padding:"9px 12px",
                  fontSize:12,
                  fontWeight:700,
                  fontFamily:"inherit",
                  outline:"none"
                }}
              />
              <div style={{fontSize:10.5,color:G,fontWeight:800,whiteSpace:"nowrap"}}>
                {formatMonthInputLabel(revenueMonth)}
              </div>
            </div>
          ) : null}
          onRowClick={selectedDetail === "trips" ? (row) => {
            if (row?.trip) {
              setSelectedDetail(null);
              onViewDetails(row.trip);
            }
          } : null}
          onClose={() => setSelectedDetail(null)}
        />
      )}
    </div>
  );
}

/* ── Trips ── */
function TripsPage({trips, onViewDetails, onComplete}){
  const [filter,setFilter]=useState("all");
  const [search,setSearch]=useState("");
  const filters=["all","active","delayed","completed"];

  const checkDelayed = (t) => {
    if (t.status.toLowerCase() === 'completed') return false;
    if (t.status.toLowerCase() === 'delayed') return true;
    return t.autoEndDateRaw && new Date() > new Date(t.autoEndDateRaw);
  };

  const filtered=(trips || []).filter(t=>{
    const isDelayed = checkDelayed(t);
    const matchesFilter = filter === "all" || 
                         (filter === "active" && t.status.toLowerCase() === "active") ||
                         (filter === "delayed" && isDelayed) ||
                         (filter === "completed" && t.status.toLowerCase() === "completed");
    
    const matchesSearch = (t.truck || "").toLowerCase().includes(search.toLowerCase()) ||
                         (t.route || "").toLowerCase().includes(search.toLowerCase()) ||
                         (t.dest || "").toLowerCase().includes(search.toLowerCase()) ||
                         (t.driver || "").toLowerCase().includes(search.toLowerCase());
    
    return matchesFilter && matchesSearch;
  });

  return(
    <div style={{padding:MOBILE_DENSE?"12px":"16px"}} className="no-scrollbar">
      <div style={{display:"flex",gap:4,background:BG2,padding:4,borderRadius:10,marginBottom:MOBILE_DENSE?10:14,overflowX:"auto",justifyContent: "flex-start"}} className="no-scrollbar">
        {filters.map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{flex:"0 0 auto",
            padding:MOBILE_DENSE?"6px 12px":"7px 14px",borderRadius:7,border:"none",cursor:"pointer",
            fontFamily:"'DM Sans',sans-serif",fontSize:MOBILE_DENSE?10:11,fontWeight:700,
            background:filter===f?WH:"transparent",
            color:filter===f?INK:MU,
            boxShadow:filter===f?"0 1px 3px rgba(26,24,20,0.08)":"none",
            transition:"all 0.12s",textTransform:"capitalize"}}>
            {f==="all"?"All Trips":f.charAt(0).toUpperCase()+f.slice(1)}
          </button>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8,background:WH,
        border:`1.5px solid ${BD}`,borderRadius:9,padding:MOBILE_DENSE?"8px 12px":"9px 14px",marginBottom:MOBILE_DENSE?12:16}}>
        <span style={{fontSize:14,color:MU2}}>🔍</span>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search trucks, routes, drivers…"
          style={{border:"none",outline:"none",flex:1,
            fontFamily:"'DM Sans',sans-serif",fontSize:MOBILE_DENSE?11.5:12.5,color:INK,background:"transparent"}}/>
      </div>
      <SecHd left={<>{filtered.length} <em style={{fontStyle:"italic",color:G}}>Trip{filtered.length!==1?"s":""}</em></>}/>
      <div style={{display:"flex",flexDirection:"column",gap:MOBILE_DENSE?10:12}}>
        {filtered.length?filtered.map(t=>(
            <TripCard 
                key={t.id} 
                trip={t} 
                onComplete={() => onComplete(t)}
                onViewDetails={() => onViewDetails(t)}
            />
        )):(
          <div style={{textAlign:"center",padding:"48px 0",color:MU}}>
            <div style={{fontSize:36,marginBottom:10}}>📦</div>
            <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>No trips found</div>
          </div>
        )}
      </div>

      <div style={{position:"sticky",bottom:16,display:"flex",justifyContent:"flex-end",marginTop:12,pointerEvents:"none",zIndex:50}}>
        <button onClick={() => navigateToAppPage('log-trip.html')}
          style={{pointerEvents:"all",background:G,color:WH,border:"none",borderRadius:28,padding:MOBILE_DENSE?"11px 16px":"13px 20px",fontSize:MOBILE_DENSE?11:12,fontWeight:700,cursor:"pointer",boxShadow:"0 4px 20px rgba(26,92,58,0.4)",display:"flex",alignItems:"center",gap:7}}>
          ✚ Log New Trip
        </button>
      </div>
    </div>
  );
}

/* ── Finance ── */
function ExpenseReviewModal({expense, onClose, onRefresh, reviewerName}){
  const [busy,setBusy]=useState(false);
  const [rejecting,setRejecting]=useState(false);
  const [reason,setReason]=useState("");
  if(!expense) return null;

  const statusMeta=expenseStatusInfo(expense.status);
  const submitReview=async(status)=>{
    setBusy(true);
    try{
      const res=await fetch(`${window.FLEETOS_API_BASE || ''}/api/expenses/${expense.id}/status`,{
        method:'PUT',
        headers:{...getApiHeaders(),'Content-Type':'application/json'},
        body:JSON.stringify({status,rejectionReason:status==="Rejected"?reason:"",reviewedBy:reviewerName || 'Transporter'})
      });
      const data=await res.json();
      if(!res.ok) throw new Error(data.error || 'Review failed');
      onRefresh && onRefresh();
      onClose();
    }catch(err){
      alert(err.message || 'Review failed');
    }finally{
      setBusy(false);
    }
  };

  return(
    <div style={{position:'fixed',inset:0,background:'rgba(26,24,20,0.72)',backdropFilter:'blur(12px)',zIndex:120000,display:'flex',alignItems:'center',justifyContent:'center',padding:18}} onClick={onClose}>
      <div style={{background:WH,border:`1px solid ${BD}`,borderRadius:26,width:'100%',maxWidth:360,maxHeight:'88vh',overflow:'hidden',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'22px 20px 16px',borderBottom:`1px solid ${BD}`,background:`linear-gradient(180deg,${WH},${BG})`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
            <div>
              <div style={{fontSize:10,fontWeight:900,letterSpacing:1.2,textTransform:'uppercase',color:S,marginBottom:6}}>{expense.tripId || expense.trip_id || 'Driver Expense'}</div>
              <div style={{fontFamily:"'Sora',sans-serif",fontSize:20,fontWeight:900,color:INK}}>{expense.expense_type || expense.category || 'General'}</div>
              <div style={{fontSize:12,color:MU,fontWeight:600,marginTop:4}}>{expense.driverName || expense.driver_name || 'Driver'} · {formatRouteLabel(expense.from || expense.route_from, expense.to || expense.route_to)}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontFamily:"'Sora',sans-serif",fontSize:20,fontWeight:900,color:CR}}>{formatPaise(expense.amount)}</div>
              <span style={{display:'inline-flex',marginTop:6,fontSize:10,fontWeight:800,padding:'4px 9px',borderRadius:999,background:statusMeta.bg,color:statusMeta.color}}>{statusMeta.label}</span>
            </div>
          </div>
        </div>

        <div style={{padding:20,overflowY:'auto'}} className="no-scrollbar">
          {[
            ['Expense Type', expense.expense_type || expense.category || 'General'],
            ['Trip ID', expense.tripId || expense.trip_id || '---'],
            ['Route', formatRouteLabel(expense.from || expense.route_from, expense.to || expense.route_to)],
            ['Expense Date', expense.date || '---'],
            ['Place', expense.place || '---'],
            ['Truck', expense.truck_id || '---'],
            ['Vendor', expense.merchant || '---'],
            ['Status', statusMeta.label]
          ].map(([label,value])=>(
            <div key={label} style={{display:'flex',justifyContent:'space-between',gap:12,padding:'10px 0',borderBottom:`1px solid ${BD2}`}}>
              <div style={{fontSize:11,color:MU,fontWeight:700}}>{label}</div>
              <div style={{fontSize:12.5,color:INK,fontWeight:700,textAlign:'right'}}>{value}</div>
            </div>
          ))}

          {expense.bill_image_data && (
            <div style={{marginTop:16}}>
              <div style={{fontSize:10,fontWeight:900,letterSpacing:1.1,textTransform:'uppercase',color:MU,marginBottom:8}}>Scanned Bill</div>
              <img src={expense.bill_image_data} alt="Expense bill" style={{width:'100%',borderRadius:18,border:`1px solid ${BD}`,display:'block'}} />
              <a href={expense.bill_image_data} download={`expense-${expense.id}.jpg`} style={{display:'inline-flex',marginTop:10,padding:'10px 14px',borderRadius:12,border:`1px solid ${BD}`,textDecoration:'none',fontSize:11.5,fontWeight:800,color:INK,background:BG}}>Download Bill</a>
            </div>
          )}

          {expense.status !== 'Approved' && expense.status !== 'Rejected' && (
            <div style={{marginTop:18,display:'grid',gap:10}}>
              {rejecting && (
                <textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason for rejection (optional)" style={{minHeight:72,border:`1px solid ${BD}`,borderRadius:14,padding:12,fontFamily:"'DM Sans',sans-serif",fontSize:12.5,resize:'vertical',outline:'none'}} />
              )}
              <button disabled={busy} onClick={()=>submitReview('Approved')} style={{padding:'13px 14px',borderRadius:14,border:'none',background:G,color:WH,fontWeight:800,cursor:'pointer'}}>Approve Expense</button>
              {!rejecting ? (
                <button disabled={busy} onClick={()=>setRejecting(true)} style={{padding:'13px 14px',borderRadius:14,border:`1px solid ${CR}`,background:WH,color:CR,fontWeight:800,cursor:'pointer'}}>Reject Expense</button>
              ) : (
                <button disabled={busy} onClick={()=>submitReview('Rejected')} style={{padding:'13px 14px',borderRadius:14,border:'none',background:CR,color:WH,fontWeight:800,cursor:'pointer'}}>Confirm Rejection</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InvoicePaymentModal({invoice, onClose, onRefresh}) {
  const [paymentDate, setPaymentDate] = useState(() => {
    const existing = invoice?.paymentDate || invoice?.trip?.paymentDate || invoice?.trip?.payment_date;
    if (existing && /^\d{4}-\d{2}-\d{2}$/.test(String(existing))) return String(existing);
    const parsed = parseFlexibleDate(existing);
    return parsed ? parsed.toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
  });
  const [busy, setBusy] = useState(false);
  const dateInputRef = useRef(null);
  if (!invoice?.trip) return null;

  const trip = invoice.trip;
  const tripEndDate = getTripCompletionDate(trip);
  const paymentDateLabel = formatDateLabel(paymentDate);
  const predictedCreditPeriod = getCreditPeriodDays({ ...trip, paymentDate });

  const submitPayment = async () => {
    if (!paymentDate) {
      alert("Select the payment received date.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${window.FLEETOS_API_BASE || ''}/api/fleet/trips/${trip.id}`, {
        method: 'PUT',
        headers: { ...getApiHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPaid: true, paymentDate })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to mark invoice as paid');
      onRefresh && onRefresh();
      onClose();
    } catch (err) {
      alert(err.message || 'Failed to mark invoice as paid');
    } finally {
      setBusy(false);
    }
  };

  return(
    <div style={{position:'fixed',inset:0,background:'rgba(26,24,20,0.72)',backdropFilter:'blur(12px)',zIndex:120000,display:'flex',alignItems:'center',justifyContent:'center',padding:18}} onClick={onClose}>
      <div style={{background:WH,border:`1px solid ${BD}`,borderRadius:26,width:'100%',maxWidth:360,maxHeight:'88vh',overflow:'hidden',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'22px 20px 16px',borderBottom:`1px solid ${BD}`,background:`linear-gradient(180deg,${WH},${BG})`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
            <div>
              <div style={{fontSize:10,fontWeight:900,letterSpacing:1.2,textTransform:'uppercase',color:S,marginBottom:6}}>Mark Invoice Paid</div>
              <div style={{fontFamily:"'Sora',sans-serif",fontSize:18,fontWeight:900,color:INK}}>{invoice.client || "Route Client"}</div>
              <div style={{fontSize:12,color:MU,fontWeight:600,marginTop:4}}>{invoice.routeLabel || formatRouteLabel(trip.route, trip.dest)}</div>
            </div>
            <button onClick={onClose} style={{width:34,height:34,borderRadius:12,border:`1px solid ${BD}`,background:WH,color:INK2,fontSize:18,cursor:'pointer',lineHeight:1}}>×</button>
          </div>
        </div>

        <div style={{padding:20,overflowY:'auto'}} className="no-scrollbar">
          {[
            ['Trip ID', trip.id || invoice.num || '---'],
            ['Truck', trip.truck || trip.truck_text || invoice.truck || '---'],
            ['Driver', trip.driver || trip.driver_text || invoice.driver || '---'],
            ['Trip Route', invoice.routeLabel || formatRouteLabel(trip.route, trip.dest)],
            ['Trip Ended On', formatDateLabel(tripEndDate)],
            ['Invoice Amount', formatRupees(invoice.amount || 0)]
          ].map(([label,value])=>(
            <div key={label} style={{display:'flex',justifyContent:'space-between',gap:12,padding:'10px 0',borderBottom:`1px solid ${BD2}`}}>
              <div style={{fontSize:11,color:MU,fontWeight:700}}>{label}</div>
              <div style={{fontSize:12.5,color:INK,fontWeight:700,textAlign:'right'}}>{value}</div>
            </div>
          ))}

          <div style={{marginTop:18}}>
            <div style={{fontSize:10,fontWeight:900,letterSpacing:1.1,textTransform:'uppercase',color:MU,marginBottom:8}}>Payment Received Date</div>
            <input ref={dateInputRef} type="date" value={paymentDate} onChange={(e)=>setPaymentDate(e.target.value)} style={{position:'absolute',opacity:0,pointerEvents:'none',width:1,height:1}} />
            <button
              type="button"
              onClick={() => {
                if (dateInputRef.current?.showPicker) dateInputRef.current.showPicker();
                else dateInputRef.current?.click();
              }}
              style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'14px 16px',borderRadius:16,border:`1px solid ${BD}`,background:BG,cursor:'pointer'}}
            >
              <span style={{fontSize:14,fontWeight:800,color:INK}}>{paymentDateLabel}</span>
              <span style={{fontSize:18}}>🗓️</span>
            </button>
          </div>

          <div style={{marginTop:14,padding:'14px 16px',borderRadius:16,background:GLt,border:`1px solid ${GLt2}`}}>
            <div style={{fontSize:10,fontWeight:900,letterSpacing:1.1,textTransform:'uppercase',color:G,marginBottom:6}}>Credit Period</div>
            <div style={{fontFamily:"'Sora',sans-serif",fontSize:20,fontWeight:900,color:G}}>{predictedCreditPeriod ?? 0} day{predictedCreditPeriod === 1 ? '' : 's'}</div>
            <div style={{fontSize:11.5,color:MU,marginTop:4}}>Calculated from trip end date to payment received date.</div>
          </div>

          <div style={{display:'grid',gap:10,marginTop:18}}>
            <button disabled={busy} onClick={submitPayment} style={{padding:'13px 14px',borderRadius:14,border:'none',background:G,color:WH,fontWeight:800,cursor:'pointer'}}>Confirm Payment</button>
            <button disabled={busy} onClick={onClose} style={{padding:'13px 14px',borderRadius:14,border:`1px solid ${BD}`,background:WH,color:INK2,fontWeight:800,cursor:'pointer'}}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FinancePage({ledger, invoices, onRefresh, reviewerName, initialTab = "ledger"}){
  const [tab,setTab]=useState(initialTab);
  const [selectedExpense,setSelectedExpense]=useState(null);
  const [selectedInvoice,setSelectedInvoice]=useState(null);
  const liveLedger = Array.isArray(ledger) ? ledger : [];
  const liveInvoices = Array.isArray(invoices) && invoices.length ? invoices : [];
  const reviewQueue = liveLedger.filter((entry)=>entry.status !== 'Approved' && entry.status !== 'Rejected');
  const approvedExpenses = liveLedger.filter((entry)=>entry.status === 'Approved');
  const rejectedExpenses = liveLedger.filter((entry)=>entry.status === 'Rejected');
  const ledgerTotalPaise = liveLedger.reduce((sum, entry)=>sum + (Number(entry.total_paise ?? entry.amount ?? 0) || 0), 0);
  const approvedPaise = approvedExpenses.reduce((sum, entry)=>sum + (Number(entry.total_paise ?? entry.amount ?? 0) || 0), 0);
  const pendingInvoiceBalancePaise = liveInvoices
    .filter((inv) => String(inv.status || "").toLowerCase() !== "paid")
    .reduce((sum, inv) => sum + (Number(inv.amount || 0) * 100), 0);
  return(
    <div style={{padding:MOBILE_DENSE?"12px":"16px"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:MOBILE_DENSE?6:8,marginBottom:MOBILE_DENSE?12:16}}>
        {[
          {l:"Ledger Total",v:formatPaise(ledgerTotalPaise),c:G,spark:[36,40,35,48,44,48]},
          {l:"In Review",v:String(reviewQueue.length),c:GO,spark:[24,26,25,29,28,32]},
          {l:"Approved",v:formatPaise(approvedPaise),c:S,spark:[10,14,10,19,16,17]},
        ].map((k,i)=>(
          <div key={i} style={{background:WH,border:`1px solid ${BD}`,borderRadius:10,padding:MOBILE_DENSE?"10px 8px":"12px 10px",textAlign:"center"}}>
            <Spark data={k.spark} color={k.c}/>
            <div style={{fontFamily:"'Sora',sans-serif",fontWeight:900,fontSize:MOBILE_DENSE?15:17,color:k.c,letterSpacing:-0.5,margin:"4px 0 2px"}}>{k.v}</div>
            <div style={{fontSize:MOBILE_DENSE?7.5:8.5,fontWeight:700,letterSpacing:0.8,textTransform:"uppercase",color:MU}}>{k.l}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",gap:4,background:BG2,padding:4,borderRadius:10,marginBottom:MOBILE_DENSE?12:16}}>
        {[["ledger","₹ Ledger"],["invoices","🔖 Invoices"],["pl","📊 P&L"]].map(([key,label])=>(
          <button key={key} onClick={()=>setTab(key)} style={{flex:1,padding:MOBILE_DENSE?"7px 0":"8px 0",borderRadius:7,
            border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",
            fontSize:MOBILE_DENSE?10:11,fontWeight:700,
            background:tab===key?WH:"transparent",
            color:tab===key?INK:MU,
            boxShadow:tab===key?"0 1px 3px rgba(26,24,20,0.08)":"none",
            transition:"all 0.12s"}}>
            {label}
          </button>
        ))}
      </div>

      {tab==="ledger"&&(
        <>
          <SecHd left={<>Cost <em style={{fontStyle:"italic",color:G}}>Ledger</em></>}/>
          <Card>
            {ledger && ledger.length > 0 ? ledger.map((e,i)=>(
              <div key={e.id} onClick={()=>setSelectedExpense(e)} style={{padding:"14px 16px",
                borderBottom:i<ledger.length-1?`1px solid ${BD}`:"none",
                display:"flex",alignItems:"center",gap:12,cursor:'pointer'}}>
                <div style={{width:36,height:36,borderRadius:9,flexShrink:0,
                  background:SLt,
                  display:"flex",alignItems:"center",justifyContent: "flex-start",fontSize:15}}>
                  🧾
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:700,color:INK,marginBottom:3,
                    whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{e.expense_type || e.category || e.desc}</div>
                  <div style={{display:"flex",gap:7,alignItems:"center"}}>
                    <span style={{fontSize:10.5,color:MU}}>{e.tripId || e.trip_id || 'No Trip'}</span>
                    <span style={{fontSize:10.5,color:MU}}>{formatRouteLabel(e.from || e.route_from, e.to || e.route_to)}</span>
                  </div>
                  <div style={{display:'flex',gap:7,alignItems:'center',marginTop:4}}>
                    <span style={{fontSize:10.5,color:MU}}>{e.date}</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:9.5,color:MU2,
                      background:expenseStatusInfo(e.status).bg,padding:"2px 6px",borderRadius:999,color:expenseStatusInfo(e.status).color}}>{expenseStatusInfo(e.status).label}</span>
                  </div>
                </div>
                <div style={{fontFamily:"'Sora',sans-serif",fontWeight:900,fontSize:14,
                  color:CR,flexShrink:0}}>
                  {formatPaise(e.amount)}
                </div>
              </div>
            )) : <div style={{padding:40, textAlign:'center', color:MU}}>No ledger entries found.</div>}
          </Card>
        </>
      )}

      {tab==="invoices"&&(
        <>
          <SecHd left={<><em style={{fontStyle:"italic",color:G}}>Invoices</em></>}/>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {liveInvoices.length > 0 ? liveInvoices.map((inv,i)=>{
              const statusKey = String(inv.status || "pending").toLowerCase();
              const sm={overdue:{bg:CRLt,c:CR,l:"Overdue"},pending:{bg:GOLt,c:GO,l:"Pending"},paid:{bg:GLt2,c:G,l:"Paid"}}[statusKey] || {bg:BG,c:INK2,l:"Open"};
              const creditPeriodLabel = statusKey === "paid" && inv.creditPeriodDays !== null && inv.creditPeriodDays !== undefined
                ? `Credit Period ${inv.creditPeriodDays} day${Number(inv.creditPeriodDays) === 1 ? '' : 's'}`
                : "";
              return(
                <Card key={i}>
                  <div style={{padding:"16px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11.5,color:MU,marginBottom:4}}>{inv.num}</div>
                        <div style={{fontSize:13.5,fontWeight:700,color:INK,marginBottom:3}}>{inv.client}</div>
                        <div style={{fontSize:11,color:MU}}>{[inv.routeLabel, inv.date].filter(Boolean).join(" • ")}</div>
                        {(inv.consignor || inv.advanceAmount) && (
                          <div style={{fontSize:10.5,color:MU2,marginTop:6}}>
                            {[inv.consignor ? `Consignor: ${inv.consignor}` : null, Number(inv.advanceAmount || 0) > 0 ? `Advance: ${formatRupees(inv.advanceAmount)}` : null].filter(Boolean).join(" • ")}
                          </div>
                        )}
                        {creditPeriodLabel && (
                          <div style={{fontSize:10.5,color:MU,marginTop:6}}>{creditPeriodLabel}</div>
                        )}
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontFamily:"'Sora',sans-serif",fontWeight:900,fontSize:22,
                          color:INK,letterSpacing:-0.5,marginBottom:6}}>
                          {formatRupees(inv.amount)}
                        </div>
                        <span style={{background:sm.bg,color:sm.c,fontSize:10,fontWeight:700,
                          padding:"3px 10px",borderRadius:20}}>{sm.l}</span>
                      </div>
                    </div>
                    {statusKey!=="paid"&&(
                      <div style={{display:"flex",gap:8,marginTop:14}}>
                        <button onClick={()=>setSelectedInvoice(inv)} style={{flex:1,padding:"9px",borderRadius:8,border:"none",
                          background:G,color:WH,fontSize:11,fontWeight:700,cursor:"pointer",
                          fontFamily:"'DM Sans',sans-serif"}}>Mark Paid ✓</button>
                      </div>
                    )}
                  </div>
                </Card>
              );
            }) : <Card style={{padding:40, textAlign:'center', color:MU}}>No invoices found.</Card>}
          </div>
        </>
      )}

      {tab==="pl"&&(
        <>
          <SecHd left={<>P&amp;L <em style={{fontStyle:"italic",color:G}}>Report</em></>}/>
          <Card>
            <div style={{padding:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                marginBottom:14,paddingBottom:10,borderBottom:`1px solid ${BD}`}}>
                <div style={{fontFamily:"'Sora',sans-serif",fontWeight:900,fontSize:15,color:INK}}>February 2026</div>
                <Tag color={G} bg={GLt2}>MTD</Tag>
              </div>
              {[
                {l:"Approved Expenses",a:-approvedPaise,t:"expense",bold:false},
                {l:"Pending Approval",a:-reviewQueue.reduce((sum, entry)=>sum + (Number(entry.total_paise ?? entry.amount ?? 0) || 0), 0),t:"expense",bold:false},
                {l:"Rejected Expenses",a:-rejectedExpenses.reduce((sum, entry)=>sum + (Number(entry.total_paise ?? entry.amount ?? 0) || 0), 0),t:"expense",bold:false},
                {l:"Total Logged Expenses",a:-ledgerTotalPaise,t:"expense",bold:true},
                {l:"Open Invoices",a:pendingInvoiceBalancePaise,t:"income",bold:false},
                {l:"Net After Approved",a:(pendingInvoiceBalancePaise - approvedPaise),t:"profit",bold:true},
              ].map((row,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",
                  padding:"9px 0",
                  borderBottom:i<5?`1px solid ${BD}`:"none",
                  borderTop:i===5?`2px solid ${INK}`:"none",
                  marginTop:i===5?4:0}}>
                  <div style={{fontSize:row.bold?12.5:12,fontWeight:row.bold?800:500,color:row.bold?INK:INK2}}>{row.l}</div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:row.bold?13:12,
                    fontWeight:row.bold?700:400,
                    color:row.t==="income"?G:row.t==="expense"?CR:S}}>
                    {row.a < 0 ? '-' : row.a > 0 ? '+' : ''}{formatPaise(Math.abs(row.a))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {selectedExpense && <ExpenseReviewModal expense={selectedExpense} onClose={()=>setSelectedExpense(null)} onRefresh={onRefresh} reviewerName={reviewerName} />}
      {selectedInvoice && <InvoicePaymentModal invoice={selectedInvoice} onClose={()=>setSelectedInvoice(null)} onRefresh={onRefresh} />}
    </div>
  );
}

/* ── Insights ── */
function InsightsPage({insights}){
  return(
    <div style={{padding:"16px"}}>
      <SecHd left={<>Global <em style={{fontStyle:"italic",color:G}}>Insights</em></>}/>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {insights && insights.length > 0 ? insights.map((insight,i)=>(
          <Card key={i}>
            <div style={{padding:"16px",display:"flex",gap:14}}>
              <div style={{width:44,height:44,borderRadius:12,flexShrink:0,
                background:insight.type==='warn'?'#fff8e6':'#e6f4ea',
                display:"flex",alignItems:"center",justifyContent: "flex-start",fontSize:22}}>
                {insight.icon}
              </div>
              <div style={{flex:1}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <div style={{fontSize:14,fontWeight:800,color:INK}}>{insight.title}</div>
                  <div style={{display:'flex', gap:4}}>
                    <Tag color={insight.type==='warn'?GO:G} bg={insight.type==='warn'?'#fff8e6':'#e6f4ea'}>{insight.tag}</Tag>
                  </div>
                </div>
                <div style={{fontSize:12,color:MU,lineHeight:1.55}}>{insight.body}</div>
              </div>
            </div>
          </Card>
        )) : (
          <div style={{textAlign:"center",padding:"60px 0",color:MU}}>
            <div style={{fontSize:40,marginBottom:12}}>🔍</div>
            <div style={{fontWeight:700,fontSize:14}}>No new insights</div>
            <div style={{fontSize:12}}>System is fully optimized</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Alerts ── */
function AlertsPage({alerts}){
  const [dismissed,setDismissed]=useState([]);
  const [selectedAlert,setSelectedAlert]=useState(null);
  const visible=(alerts || []).filter(a=>!dismissed.includes(a.id));
  const typeStyle={
    crit:{borderColor:CR,bg:CRLt},
    warn:{borderColor:GO,bg:GOLt},
    info:{borderColor:G,bg:GLt},
  };

  return(
    <div style={{padding:"16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontFamily:"'Sora',sans-serif",fontWeight:900,fontSize:18,color:INK}}>
          Alerts &amp; <em style={{fontStyle:"italic",color:G}}>Notifications</em>
        </div>
        <Tag color={CR} bg={CRLt}>
          {(alerts || []).filter(a=>a.type==="crit"&&!dismissed.includes(a.id)).length} Critical
        </Tag>
      </div>

      {visible.length===0?(
        <div style={{textAlign:"center",padding:"60px 0",color:MU}}>
          <div style={{fontSize:40,marginBottom:12}}>✅</div>
          <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>All clear!</div>
          <div style={{fontSize:12}}>No active alerts</div>
          {dismissed.length>0&&(
            <span onClick={()=>setDismissed([])} style={{display:"block",marginTop:16,fontSize:11.5,color:G,fontWeight:700,cursor:"pointer"}}>
              Restore {dismissed.length} dismissed
            </span>
          )}
        </div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {visible.map(a=>{
            const s=typeStyle[a.type];
            return(
              <div key={a.id} onClick={() => setSelectedAlert(a)} style={{background:s.bg,borderRadius:10,
                borderLeft:`4px solid ${s.borderColor}`,padding:"14px 16px",
                display:"flex",gap:12,cursor:"pointer",
                boxShadow:"0 1px 4px rgba(26,24,20,0.07)"}}>
                <div style={{fontSize:20,flexShrink:0,marginTop:1}}>{a.icon}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:INK,marginBottom:4}}>{a.title}</div>
                  <div style={{fontSize:11.5,color:MU,lineHeight:1.55,marginBottom:8}}>{a.desc}</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:10,color:MU2,fontFamily:"'JetBrains Mono',monospace"}}>{a.time}</span>
                    <div style={{display:"flex",gap:12}}>
                      <span onClick={e=>{e.stopPropagation();setDismissed(d=>[...d,a.id]);}}
                        style={{fontSize:11,color:MU,cursor:"pointer",fontWeight:600}}>Dismiss</span>
                      <span style={{fontSize:11,color:G,fontWeight:700,cursor:"pointer"}}>{a.action || "View"} →</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {dismissed.length>0&&(
            <div style={{textAlign:"center",paddingTop:8}}>
              <span onClick={()=>setDismissed([])} style={{fontSize:11.5,color:G,fontWeight:700,cursor:"pointer"}}>
                ↺ Restore {dismissed.length} dismissed alert{dismissed.length>1?"s":""}
              </span>
            </div>
          )}
        </div>
      )}

      {selectedAlert && (
        <DetailSheet
          title={selectedAlert.title}
          subtitle={selectedAlert.desc}
          summary={selectedAlert.time ? `Alert triggered ${selectedAlert.time}.` : ""}
          rows={(selectedAlert.details || []).map(([title, value]) => ({
            title,
            meta: "Operational detail",
            value,
            tone: selectedAlert.type === "crit" ? "warn" : selectedAlert.type === "warn" ? "neutral" : "good"
          }))}
          footer={selectedAlert.action ? `Suggested action: ${selectedAlert.action}` : ""}
          onClose={() => setSelectedAlert(null)}
        />
      )}
    </div>
  );
}

/* ── Drivers ── */
function DriversPage({drivers, trips, onAddDriver, onItemClick}){
  const [search,setSearch]=useState("");
  const [permission, setPermission] = useState(localStorage.getItem('phonePermission') === 'granted');
  const [showPermModal, setShowPermModal] = useState(false);
  const [pendingCall, setPendingCall] = useState(null);

  const filtered = (drivers || []).filter(d => {
    return (d.name || "").toLowerCase().includes(search.toLowerCase()) || 
           (d.id || "").toString().toLowerCase().includes(search.toLowerCase());
  });

  const handleCall = (driver) => {
    if (!permission) {
      setPendingCall(driver);
      setShowPermModal(true);
    } else {
      window.location.href = `tel:${driver.phone || '9999999999'}`;
    }
  };

  const grantPermission = () => {
    localStorage.setItem('phonePermission', 'granted');
    setPermission(true);
    setShowPermModal(false);
    if (pendingCall) {
      window.location.href = `tel:${pendingCall.phone || '9999999999'}`;
      setPendingCall(null);
    }
  };

  const counts = {
    total: drivers.length,
    onDuty: drivers.filter(d => (d.status || "").toLowerCase() === "active").length,
    onLeave: drivers.filter(d => (d.status || "").toLowerCase() === "idle").length
  };

  return(
    <div style={{padding:"16px"}}>
      {showPermModal && (
        <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:200000, display:'flex', alignItems:'center', justifyContent:'center', padding:20, backdropFilter:'blur(4px)'}}>
          <div style={{background:WH, borderRadius:20, padding:24, width:'100%', maxWidth:300, textAlign:'center'}}>
            <div style={{fontSize:40, marginBottom:16}}>📞</div>
            <div style={{fontFamily:"'Sora',sans-serif", fontWeight:800, fontSize:18, color:INK, marginBottom:8}}>Phone Permission</div>
            <div style={{fontSize:13, color:MU, marginBottom:20, lineHeight:1.5}}>FleetOS needs permission to access your dialer to place calls.</div>
            <button onClick={grantPermission} style={{width:'100%', padding:14, borderRadius:12, border:'none', background:G, color:WH, fontWeight:700, marginBottom:10, cursor:'pointer'}}>Allow Access</button>
            <button onClick={()=>setShowPermModal(false)} style={{width:'100%', padding:12, borderRadius:12, border:`1px solid ${BD}`, background:'transparent', color:MU, fontWeight:600, cursor:'pointer'}}>Deny</button>
          </div>
        </div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <SecHd left={<>Driver <em style={{fontStyle:"italic",color:G}}>Roster</em></>} style={{margin:0,border:0,padding:0}} />
        <button 
          onClick={() => window.location.href=withFleetToken('/api/export/drivers')}
          style={{padding:"8px 14px",borderRadius:8,border:`1.5px solid ${G}`,background:WH,color:G,fontSize:11,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontFamily:"'DM Sans',sans-serif"}}>
          📊 Export
        </button>
      </div>

      <div style={{gridTemplateColumns:"repeat(3,1fr)",display:"grid",gap:6,marginBottom:16}}>
        {[
          {l:"Total",v:counts.total,c:INK,bg:BG},
          {l:"On Duty",v:counts.onDuty,c:G,bg:"#e6f4ea"},
          {l:"On Leave",v:counts.onLeave,c:GO,bg:"#fff8e6"}
        ].map((s,i)=>(
          <div key={i} style={{background:s.bg,border:`1px solid ${BD}`,borderRadius:9, padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontSize:8,color:MU,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",marginBottom:4}}>{s.l}</div>
            <div style={{fontFamily:"'Sora',sans-serif",fontWeight:900,fontSize:20,color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",gap:8,marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:8,background:WH, border:`1.5px solid ${BD}`,borderRadius:9,padding:"11px 16px",flex:1}}>
            <span style={{fontSize:12,color:MU2}}>🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{border:"none",outline:"none",flex:1, fontFamily:"'DM Sans',sans-serif",fontSize:11.5,color:INK,background:"transparent"}}/>
          </div>
          <button onClick={onAddDriver} style={{ background: S, color: WH, border: "none", borderRadius: 9, padding: "0 18px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif"}}>+ Add</button>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {filtered.map(d=>{
          const activeTrip = (trips || []).find(t => 
            (t.driver || "").toString().trim().toLowerCase() === (d.name || "").toString().trim().toLowerCase() && 
            (t.status === 'active' || t.status === 'delayed' || t.status === 'En Route')
          );
          return (
            <div key={d.id} onClick={(e) => { e.stopPropagation(); onItemClick(d, 'driver'); }} style={{cursor:'pointer'}}>
              <Card>
                <div style={{padding:"14px 16px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:activeTrip?14:14}}>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                        <div style={{width:44,height:44,borderRadius:"50%",background:G,color:WH,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:16}}>
                            {(d.name || "UN").split(" ").map(n=>n[0]).join("").toUpperCase()}
                        </div>
                        <div>
                            <div style={{fontSize:14,fontWeight:800,color:INK,textTransform:'uppercase'}}>{d.name}</div>
                            <div style={{fontSize:11,color:MU,marginTop:1}}>ID: {d.id} · {d.empType}</div>
                        </div>
                    </div>
                    <StatusChip status={d.status}/>
                  </div>

                  {activeTrip && (
                    <div style={{background:G + '08', borderRadius:12, padding:14, marginBottom:16, border:`1.5px dashed ${G}33`}}>
                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
                         <div style={{fontSize:9, color:G, fontWeight:800, textTransform:'uppercase', letterSpacing:1}}>Current Assignment</div>
                         <div style={{fontSize:9, color:WH, background:activeTrip.status==='active'?G:CR, padding:'2px 6px', borderRadius:4, fontWeight:800}}>{activeTrip.status.toUpperCase()}</div>
                      </div>
                      <div style={{fontSize:14, fontWeight:800, color:INK, marginBottom:2}}>{cleanLoc(activeTrip.route)} → {cleanLoc(activeTrip.dest)}</div>
                      <div style={{fontSize:10.5, color:MU}}>Trip ID: {activeTrip.id} · Updated just now</div>
                    </div>
                  )}

                  <div style={{display:"flex",gap:8}}>
                    <button onClick={(e)=>{e.stopPropagation(); handleCall(d);}} style={{flex:1,padding:"11px",borderRadius:10,border:`1.5px solid ${BD}`, background:BG,color:INK,fontSize:11.5,fontWeight:800,cursor:"pointer", display:'flex', alignItems:'center', justifyContent:'center', gap:8}}>
                      <span style={{fontSize:14}}>📞</span> Call
                    </button>
                    {activeTrip ? (
                      <button onClick={(e)=>{e.stopPropagation(); /* Potential navigation to trip detail */ }} style={{flex:1,padding:"11px",borderRadius:10,border:"none", background:G,color:WH,fontSize:11.5,fontWeight:800,cursor:"pointer", display:'flex', alignItems:'center', justifyContent:'center', gap:8}}>
                        <span>🗺️</span> View Trip
                      </button>
                    ) : (
                      <button onClick={(e)=>{e.stopPropagation(); onItemClick(d, 'driver');}} style={{flex:1,padding:"11px",borderRadius:10,border:`1.5px solid ${G}`, background:'transparent',color:G,fontSize:11.5,fontWeight:800,cursor:"pointer"}}>View Docs</button>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          );
        })}

        <div onClick={onAddDriver} style={{ background: BG, border: `2px dashed ${BD}`, borderRadius: 12, padding: "20px", textAlign: "center", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginTop: 4 }}>
          <span style={{fontSize: 24, color: MU, fontWeight: 300}}>+</span>
          <span style={{fontSize: 13, fontWeight: 700, color: MU}}>Add New Driver</span>
        </div>
      </div>
    </div>
  );
}

/* ── Fleet ── */
function FleetPage({trucks, onAddTruck, onItemClick}){
  const [search,setSearch]=useState("");
  const filtered=(trucks || []).filter(t=>
    (String(t.id || "")).toLowerCase().includes(search.toLowerCase())||
    (String(t.driver || "")).toLowerCase().includes(search.toLowerCase()));

  const counts={
    active:(trucks || []).filter(t=>t.status==="active").length,
    idle:(trucks || []).filter(t=>t.status==="idle").length,
    delayed:(trucks || []).filter(t=>t.status==="delayed").length,
    maintenance:(trucks || []).filter(t=>t.status==="maintenance").length
  };

  return(
    <div style={{padding:"16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <SecHd left={<>Fleet <em style={{fontStyle:"italic",color:G}}>Register</em></>} style={{margin:0,border:0,padding:0}} />
        <button 
          onClick={() => window.location.href=withFleetToken('/api/export/fleet')}
          style={{padding:"8px 14px",borderRadius:8,border:`1.5px solid ${G}`,background:WH,color:G,fontSize:11,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontFamily:"'DM Sans',sans-serif"}}>
          📊 Export Excel
        </button>
      </div>

      <div style={{gridTemplateColumns:"repeat(3,1fr)",display:"grid",gap:6,marginBottom:16}}>
        {[
            {l:"Total Trucks",v:(trucks || []).length,sub:"Fleet Strength",c:INK,bg:BG},
            {l:"On Duty",v:counts.active,sub:Math.round((counts.active/(trucks || []).length)*100 || 0) + "% Active",c:G,bg:"#e6f4ea"},
            {l:"Idle",v:counts.idle,sub:"At Warehouse",c:GO,bg:"#fff8e6"}
        ].map((s,i)=>(
          <div key={i} style={{background:s.bg,border:`1px solid ${BD}`,borderRadius:9,
            padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontSize:8,color:MU,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",marginBottom:4}}>{s.l}</div>
            <div style={{fontFamily:"'Sora',sans-serif",fontWeight:900,fontSize:20,color:s.c}}>{s.v}</div>
            <div style={{fontSize:7.5,color:MU2,fontWeight:600,marginTop:4,background:WH,padding:"2px 4px",borderRadius:4,display:"inline-block"}}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"stretch"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,background:WH,
            border:`1.5px solid ${BD}`,borderRadius:9,padding:"11px 16px",flex:1}}>
            <span style={{fontSize:12,color:MU2}}>🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search by plate or driver…"
              style={{border:"none",outline:"none",flex:1,
                fontFamily:"'DM Sans',sans-serif",fontSize:11.5,color:INK,background:"transparent"}}/>
          </div>
          <button onClick={onAddTruck} style={{
              background: S, color: WH, border: "none", borderRadius: 9, padding: "0 18px",
              fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
              fontFamily: "'DM Sans',sans-serif"}}>
              <span style={{fontSize:16}}>+</span> Add Truck
          </button>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {filtered.map(t=>(
          <div key={t.id} onClick={() => onItemClick(t, 'truck')} style={{cursor:'pointer'}}>
            <Card>
              <div style={{padding:"14px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{background:INK,color:WH,fontFamily:"'JetBrains Mono',monospace",
                        fontSize:11,fontWeight:600,padding:"5px 12px",borderRadius:8, display:"inline-block", marginBottom:4}}>{formatRegNo(t.id)}</div>
                    <div style={{fontSize:12,color:MU, fontWeight:500}}>{t.driver}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <StatusChip status={t.status}/>
                    <div style={{fontSize:10,color:MU2,marginTop:4}}>{t.type}</div>
                  </div>
                </div>

                <div style={{marginTop:16}}>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onItemClick(t, 'truck'); }}
                    style={{width:"100%",padding:"12px",borderRadius:10,border:"none",
                    background:G,color:WH,fontSize:12,fontWeight:700,cursor:"pointer",
                    boxShadow:`0 4px 10px ${G}33`, fontFamily:"'DM Sans',sans-serif"}}>
                    View Details
                  </button>
                </div>
              </div>
            </Card>
          </div>
        ))}

        <div 
          onClick={onAddTruck}
          style={{
            background: BG,
            border: `2px dashed ${BD}`,
            borderRadius: 12,
            padding: "24px 16px",
            textAlign: "center",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            marginTop: 4
          }}>
          <span style={{fontSize: 24, color: MU, fontWeight: 300}}>+</span>
          <span style={{fontSize: 13, fontWeight: 700, color: MU, fontFamily: "'DM Sans',sans-serif"}}>Add New Truck</span>
        </div>
      </div>
    </div>
  );
}

/* ── Profile ── */
function ProfilePage({ user }) {
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    address: user?.address || '123, Transport Hub, Mumbai',
    gst: user?.gst || '27AAACG0000A1Z5',
    pan: user?.pan || 'ABCDE1234F'
  });

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  return (
    <div style={{ padding: "16px", paddingBottom: 60 }}>
      <SecHd left={<>My <em style={{ fontStyle: "italic", color: G }}>Profile</em></>} />
      <Card style={{ marginBottom: 16 }}>
        <div style={{ padding: 24, textAlign: 'center', borderBottom: `1px solid ${BD}`, background: BG }}>
          <div style={{ 
            width: 80, height: 80, borderRadius: '50%', background: G, color: WH,
            margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, fontWeight: 900, border: `4px solid ${WH}`, boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }}>
            {(user?.fullName || "KS").split(" ").map(n => n[0]).join("").toUpperCase()}
          </div>
          <div style={{ fontFamily: "'Sora',sans-serif", fontSize: 22, fontWeight: 900, color: INK }}>{user?.fullName}</div>
          <div style={{ fontSize: 13, color: MU, fontWeight: 600, marginTop: 4 }}>{user?.companyName || "Kartik Logistics"}</div>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>
            <div>
              <div style={{ fontSize: 10, color: MU, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Login Identity</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>📧 {user?.email || 'N/A'}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>📱 {user?.mobile || 'N/A'}</div>
              </div>
            </div>
            <div style={{ paddingTop: 16, borderTop: `1px solid ${BD}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: MU, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1 }}>Business Details</div>
                <button 
                  onClick={() => setEditing(!editing)}
                  style={{ background: 'transparent', border: 'none', color: G, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                  {editing ? 'Cancel' : 'Edit Details'}
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[
                  { label: "Business Address", icon: "📍", key: "address" },
                  { label: "GST Number", icon: "📑", key: "gst" },
                  { label: "PAN Number", icon: "💳", key: "pan" }
                ].map(field => (
                  <div key={field.key}>
                    <div style={{ fontSize: 11, color: MU2, fontWeight: 700, marginBottom: 4 }}>{field.label}</div>
                    {editing ? (
                      <input 
                        name={field.key}
                        value={formData[field.key]}
                        onChange={handleChange}
                        style={{ 
                          width: '100%', padding: '10px 12px', borderRadius: 8, border: `1.5px solid ${BD}`,
                          fontSize: 13, fontFamily: 'inherit', outline: 'none', background: WH,
                          boxSizing: 'border-box'
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: 14, fontWeight: 600, color: INK2 }}>
                        <span style={{ marginRight: 8 }}>{field.icon}</span>
                        {formData[field.key]}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {editing && (
                <button 
                  onClick={() => { setEditing(false); alert("Profile Updated Successfully!"); }}
                  style={{ 
                    width: '100%', marginTop: 24, padding: 14, borderRadius: 12, 
                    background: G, color: WH, fontWeight: 800, border: 'none', cursor: 'pointer',
                    boxShadow: `0 4px 12px ${G}44`
                  }}>
                  Save Changes
                </button>
              )}
            </div>
          </div>
        </div>
      </Card>
      <div style={{ textAlign: 'center', padding: '12px 0' }}>
        <div style={{ fontSize: 11, color: MU2, fontWeight: 500 }}>Member since {new Date().getFullYear() - 1}</div>
        <div style={{ fontSize: 11, color: G, fontWeight: 700, marginTop: 4, cursor: 'pointer' }}>Share Referral Code 🎁</div>
      </div>
    </div>
  );
}

/* ── App Header ── */
function AppHeader({page,onNavigate,user,alertCount=0}){
  const [showProfile,setShowProfile]=useState(false);
  const dropdownRef = useRef(null);
  useEffect(() => {
    function handleClickOutside(event) { if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setShowProfile(false); }
    if (showProfile) document.addEventListener("mousedown", handleClickOutside);
    else document.removeEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showProfile]);

  return(
    <div style={{background:G,padding:MOBILE_DENSE?"0 12px":"0 16px",display:"flex",alignItems:"center",height:MOBILE_DENSE?52:56,boxShadow:"0 2px 12px rgba(26,92,58,0.3)",flexShrink:0,position:"relative",zIndex:100}}>
      <div style={{display:"flex",alignItems:"center",gap:MOBILE_DENSE?8:10,cursor:"pointer"}} onClick={()=>onNavigate("dashboard")}>
        <div style={{width:MOBILE_DENSE?28:32,height:MOBILE_DENSE?28:32,borderRadius:8,background:S,display:"flex",alignItems:"center",justifyContent: "flex-start",fontSize:MOBILE_DENSE?14:16}}>🚛</div>
        <div style={{fontFamily:"'Sora',sans-serif",fontWeight:900,fontSize:MOBILE_DENSE?17:19,color:WH}}>FleetOS</div>
      </div>
      <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:MOBILE_DENSE?8:10}}>
        <div style={{display:"flex",alignItems:"center",gap:5,background:"rgba(255,255,255,0.15)",color:WH,
          fontSize:MOBILE_DENSE?8:9,fontWeight:700,letterSpacing:0.5,padding:MOBILE_DENSE?"4px 8px":"4px 10px",borderRadius:20,
          border:`1px solid rgba(255,255,255,0.2)`}}>
          <span style={{width:5,height:5,borderRadius:"50%",background:WH,
            display:"inline-block",animation:"blink 1.8s infinite"}}/>
          {window.FLEET_LIVE_COUNT || 0} live
        </div>

        <div style={{position:"relative"}}>
          <div onClick={()=>onNavigate("alerts")} style={{width:MOBILE_DENSE?30:34,height:MOBILE_DENSE?30:34,borderRadius:"50%",
            background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",
            display:"flex",alignItems:"center",justifyContent:"center",fontSize:MOBILE_DENSE?14:16,cursor:"pointer",lineHeight:1}} aria-label="Open alerts">🔔</div>
          <div style={{position:"absolute",top:-3,right:-3,background:S,color:WH,
            fontSize:8.5,fontWeight:800,minWidth:16,height:16,borderRadius:"50%",
            padding:"0 4px",display:"flex",alignItems:"center",justifyContent:"center",
            border:`2px solid ${G}`,boxSizing:"border-box",lineHeight:1}}>
              {Math.min(alertCount || 0, 9)}{(alertCount || 0) > 9 ? "+" : ""}
          </div>
        </div>

        <div ref={dropdownRef} style={{position:"relative"}}>
          <div onClick={()=>setShowProfile(!showProfile)} style={{width:MOBILE_DENSE?30:34,height:MOBILE_DENSE?30:34,borderRadius:"50%",
            background:`linear-gradient(135deg,${S},${GO})`,
            display:"flex",alignItems:"center",justifyContent: "center",
            fontWeight:800,fontSize:MOBILE_DENSE?10:11,color:WH,cursor:"pointer",
            border:"2px solid rgba(255,255,255,0.25)"}}>{(user?.fullName || "KS").split(" ").map(n=>n[0]).join("").toUpperCase()}</div>
          
          {showProfile&&(
            <div style={{position:"absolute",top:"100%",right:0,
              background:WH,border:`1px solid ${BD}`,borderRadius:12,width:200,
              boxShadow:"0 10px 30px rgba(26,24,20,0.2)",zIndex:1000,overflow:"hidden",marginTop:8}}>
              <div 
                onClick={() => { setShowProfile(false); onNavigate("profile"); }}
                style={{padding:"14px 16px",borderBottom:`1px solid ${BD}`,background:BG, cursor:'pointer'}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:0}}>
                  <div style={{width:32,height:32,borderRadius:"50%",background:G,
                    display:"flex",alignItems:"center",justifyContent: "center",
                    fontWeight:800,fontSize:12,color:WH}}>{(user?.fullName || "KS").split(" ").map(n=>n[0]).join("").toUpperCase()}</div>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:800,fontSize:13,color:INK,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{user?.fullName || "Kartik Soni"}</div>
                    <div style={{fontSize:10,color:MU}}>{user?.companyName || "Kartik Logistics"}</div>
                  </div>
                </div>
              </div>
              {[["🚛","Fleet Register","fleet"],["👤","Driver Roster","drivers"]].map(([icon,label,p])=>(
                <div key={label} onClick={()=>{setShowProfile(false);onNavigate(p);}}
                  style={{padding:"11px 16px",fontSize:12,fontWeight:600,color:INK,
                    cursor:"pointer",display:"flex",alignItems:"center",gap:10,
                    borderBottom:`1px solid ${BD}`}}>
                  <span style={{fontSize:15}}>{icon}</span>{label}
                </div>
              ))}
              <div onClick={() => navigateToAppPage('log-trip.html')} 
                   style={{padding:"11px 16px",fontSize:12,fontWeight:600,color:INK,
                   cursor:"pointer",display:"flex",alignItems:"center",gap:10,
                   borderBottom:`1px solid ${BD}`}}>
                <span style={{fontSize:15}}>✚</span>Log New Trip
              </div>
              <div onClick={() => { localStorage.removeItem('fleetUser'); localStorage.removeItem('fleetToken'); navigateToAppPage('App - Login.html'); }} 
                   style={{padding:"11px 16px",fontSize:12,fontWeight:600,color:CR,
                   cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:15}}>🚪</span>Sign Out
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Bottom Nav ── */
function BottomNav({active,onChange}){
  const tabs=[
    {key:"dashboard",label:"Home",icon:"⊞"},
    {key:"trips",label:"Trips",icon:"📦"},
    {key:"finance",label:"Finance",icon:"₹"},
    {key:"insights",label:"Insights",icon:"💡"}
  ];
  return(
    <div style={{background:WH,padding:`0 ${MOBILE_DENSE ? 8 : 10}px ${MOBILE_DENSE ? 8 : 10}px`,flexShrink:0,position:"relative",zIndex:20,boxShadow:"none",borderTop:"none"}}>
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:4,background:WH,padding:`${MOBILE_DENSE ? 5 : 6}px 4px ${MOBILE_DENSE ? 7 : 8}px`}}>
        {tabs.slice(0,2).map((t)=>(
          <button key={t.key} onClick={()=>onChange(t.key)} style={{flex:1,border:"none",background:"transparent",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,color:active===t.key?G:MU2,fontFamily:"'DM Sans',sans-serif",padding:"6px 4px"}}>
            <span style={{fontSize:16,lineHeight:1,color:"inherit"}}>{t.icon}</span>
            <span style={{fontSize:8.5,fontWeight:700,color:"inherit"}}>{t.label}</span>
          </button>
        ))}
        <div style={{flex:1,display:"flex",justifyContent:"center"}}>
          <button onClick={()=>window.dispatchEvent(new CustomEvent('open-modal-page', { detail: { path: 'log-trip.html' } }))} style={{border:"none",background:"transparent",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:4,color:G,fontFamily:"'DM Sans',sans-serif",padding:"0 4px"}}>
            <span style={{width:44,height:44,borderRadius:14,background:G,display:"flex",alignItems:"center",justifyContent:"center",color:WH,boxShadow:"0 8px 20px rgba(26,92,58,0.28)",fontSize:24,lineHeight:1}}>+</span>
            <span style={{fontSize:8.5,fontWeight:800,color:G}}>New Trip</span>
          </button>
        </div>
        {tabs.slice(2).map((t)=>(
          <button key={t.key} onClick={()=>onChange(t.key)} style={{flex:1,border:"none",background:"transparent",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,color:active===t.key?G:MU2,fontFamily:"'DM Sans',sans-serif",padding:"6px 4px"}}>
            <span style={{fontSize:16,lineHeight:1,color:"inherit"}}>{t.icon}</span>
            <span style={{fontSize:8.5,fontWeight:700,color:"inherit"}}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Modal Page (Butter Smooth Navigation) ── */
function ModalPage({path, params={}, onClose}){
  const url = new URL(path, window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  return (
    <div style={{position:'fixed', inset:0, background:BG, zIndex:150000, display:'flex', flexDirection:'column', animation: 'modalSlideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1)'}}>
        <style>{`
            @keyframes modalSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        `}</style>
        <div style={{background:G, padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0}}>
            <div style={{display:'flex', alignItems:'center', gap:10}}>
                <button onClick={onClose} style={{background: 'rgba(255,255,255,0.15)', border:'none', color:WH, borderRadius:8, padding:'6px 12px', fontSize:12, fontWeight:700, cursor:'pointer'}}>← Back</button>
                <div style={{fontFamily:"'Sora',sans-serif", fontWeight:800, fontSize:15, color:WH}}>{path.includes('Truck') ? 'Add Truck' : 'Add Driver'}</div>
            </div>
            <div onClick={onClose} style={{color:WH, fontSize:22, cursor:'pointer', padding:'0 8px'}}>×</div>
        </div>
        <div style={{flex:1, position:'relative', background:BG}}>
            <iframe src={url.href} style={{width:'100%', height:'100%', border:'none'}}></iframe>
        </div>
    </div>
  );
}

/* ── ROOT APP ── */
export default function App({ user: propsUser }){
  const user = propsUser || JSON.parse(localStorage.getItem('fleetUser') || '{}');
  const searchParams = new URLSearchParams(window.location.search);
  const [page,setPage]=useState(searchParams.get("page") || "dashboard");
  const financeTab = searchParams.get("tab") || "ledger";
  const initialModal = searchParams.get("modal") || "";
  const [data, setData] = useState({
    trips:[], trucks:[], drivers:[], alerts:[], ledger:[], invoices:[],
    stats:{kpis:{},charts:{revenueVsCost:[],costBreakdown:[]}}
  });
  const [loading, setLoading] = useState(true);
  const [activeAction, setActiveAction] = useState({open:false,item:null,type:null});
  const [tripModal, setTripModal] = useState({open:false, trip:null, type:null});
  const [fleetLocations, setFleetLocations] = useState([]);
  const [showMapModal, setShowMapModal] = useState(initialModal === "map");
  const [selectedFleetLocation, setSelectedFleetLocation] = useState(null);
  const fetchInFlightRef = useRef(false);

  const handleItemClick = (item, type) => setActiveAction({open:true,item,type});
  const handleViewTrip = (trip) => setTripModal({open:true, trip, type:'details'});
  const handleCompleteTrip = (trip) => setTripModal({open:true, trip, type:'complete'});
  const handleDeleteSuccess = (type, id) => {
    setData(prev => ({...prev, [type==='truck'?'trucks':'drivers']: prev[type==='truck'?'trucks':'drivers'].filter(i=>i.id!==id)}));
  };

  const fetchData = async () => {
    if (isOcrScanLocked() || fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    let timeoutId = null;
    try {
      const user = JSON.parse(localStorage.getItem('fleetUser') || '{}');
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 8000);
      const [dataRes, locationsRes] = await Promise.all([
        fetch(`${window.FLEETOS_API_BASE || ''}/api/driver-data?userId=${user?.id || '1'}`, { headers: getApiHeaders(), signal: controller.signal }),
        fetch(`${window.FLEETOS_API_BASE || ''}/api/fleet/locations`, { headers: getApiHeaders(), signal: controller.signal })
      ]);
      clearTimeout(timeoutId);

      if (!dataRes.ok) throw new Error("API failure");
      const d = await dataRes.json();
      const locations = locationsRes.ok ? await locationsRes.json() : [];
      const trips = (d.trips || []).map(t=>({
        id:t.id,
        truck:t.truck || t.truckText,
        driver:t.driver || t.driverText,
        driverPhone: t.driverPhone,
        route:t.route || t.origin,
        dest:t.dest || t.destination,
        startDate:t.startDate,
        startDateRaw: t.startDateRaw,
        endDate: t.endDate,
        endDateRaw: t.endDateRaw,
        autoEndDateRaw: t.autoEndDateRaw,
        status:t.status,
        freight: t.freight || 0,
        totalExpenses: t.totalExpenses || 0,
        bhatta: t.bhatta || 0,
        distanceKm: t.distanceKm || t.distance_km || 0,
        truckPurchasePrice: t.truckPurchasePrice || t.truck_purchase_price || 0,
        truckTyresCount: t.truckTyresCount || t.truck_tyres_count || 0
      }));
      const trucks = (d.trucks || []).map(t=>({
        real_db_id:t.id,
        id:t.reg_no||t.id,
        status:t.status||'idle',
        driver:t.driver_assigned||'Unassigned',
        type: t.truck_type || 'Truck',
        doc_rc_path: t.doc_rc_path,
        doc_insurance_path: t.doc_insurance_path,
        doc_fitness_path: t.doc_fitness_path,
        doc_puc_path: t.doc_puc_path,
        doc_permit_path: t.doc_permit_path,
        doc_roadtax_path: t.doc_roadtax_path
      }));
      const drivers = (d.drivers || []).map(dr=>({
        id:dr.id,
        name:dr.full_name,
        phone:dr.phone,
        dob: dr.dob,
        bloodGroup: dr.blood_group,
        status:(dr.status||'active').toLowerCase(),
        empType:dr.emp_type||'Full-time',
        address: dr.address,
        city: dr.city,
        state: dr.state,
        pin: dr.pin,
        emergencyPhone: dr.emergency_phone,
        assignedTruck: dr.assigned_truck,
        dlNo: dr.dl_no,
        dlIssue: dr.dl_issue,
        dlExpiry: dr.dl_expiry,
        rto: dr.rto,
        dlState: dr.dl_state,
        licenseType: dr.license_type,
        vehicleCategory: dr.vehicle_category,
        hazmat: dr.hazmat,
        experience: dr.experience,
        aadhar: dr.aadhar,
        pan: dr.pan,
        doc_dl_path: dr.doc_dl_path,
        doc_aadhar_path: dr.doc_aadhar_path,
        doc_pan_path: dr.doc_pan_path,
        doc_photo_path: dr.doc_photo_path,
        temp_password: dr.temp_password
      }));
      const invoices = buildInvoiceRowsFromTrips(trips);
      const alerts = buildOperationalAlerts({ trips, fleetLocations: locations, invoices });
      
      setData({
        trips,
        trucks,
        drivers,
        stats: {
          kpis: d.stats || {},
          charts: d.charts || {revenueVsCost:[],costBreakdown:[]}
        },
        ledger: d.expenses || [],
        invoices,
        alerts
      });
      window.__FLEET_TRIPS__ = (d.trips || []).map(t=>({
        id:t.id,
        truck:t.truck || t.truckText || t.truck_text,
        startDateRaw:t.startDateRaw || t.start_date_raw,
        endDateRaw:t.endDateRaw || t.end_date_raw,
        autoEndDateRaw:t.autoEndDateRaw || t.auto_end_date_raw,
        status:t.status
      }));
      if (locationsRes.ok) {
        setFleetLocations(locations);
        setSelectedFleetLocation(prev => {
          if (prev) {
            const latestMatch = locations.find(loc => String(loc.id) === String(prev.id));
            if (latestMatch) return latestMatch;
          }
          return locations.find(loc => loc.location_alert) || locations[0] || null;
        });
        window.FLEET_LIVE_COUNT = locations.length;
      }
      
      setLoading(false);
    } catch (e) { 
      console.error("Fetch Error:", e); 
      setLoading(false); 
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      fetchInFlightRef.current = false;
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden || isOcrScanLocked()) return;
      fetchData();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!fleetLocations.length) {
      setSelectedFleetLocation(null);
      return;
    }
    if (!selectedFleetLocation) {
      setSelectedFleetLocation(fleetLocations.find(loc => loc.location_alert) || fleetLocations[0]);
      return;
    }
    const next = fleetLocations.find(loc => String(loc.id) === String(selectedFleetLocation.id));
    if (next && next !== selectedFleetLocation) {
      setSelectedFleetLocation(next);
    }
  }, [fleetLocations, selectedFleetLocation]);

  const [modalPage, setModalPage] = useState(null);

  useEffect(() => {
    const handler = (e) => setModalPage(e.detail);
    window.addEventListener('open-modal-page', handler);
    return () => window.removeEventListener('open-modal-page', handler);
  }, []);

  const openAppModal = (path, params={}) => setModalPage({path, params});

  const pages={
    dashboard:<DashboardPage onNavigate={setPage} stats={data.stats.kpis} charts={data.stats.charts} trips={data.trips} trucks={data.trucks} invoices={data.invoices} ledger={data.ledger} onViewDetails={handleViewTrip} onViewMap={() => setShowMapModal(true)} />,
    trips:<TripsPage trips={data.trips} onViewDetails={handleViewTrip} onComplete={handleCompleteTrip} />,
    finance:<FinancePage ledger={data.ledger} invoices={data.invoices} onRefresh={fetchData} reviewerName={user?.fullName} initialTab={financeTab} />,
    insights:<InsightsPage insights={data.stats.insights} />,
    alerts:<AlertsPage alerts={data.alerts} />,
    fleet:<FleetPage trucks={data.trucks} onAddTruck={()=>openAppModal('Fleetos Add Truck.html')} onItemClick={handleItemClick} />,
    drivers:<DriversPage drivers={data.drivers} trips={data.trips} onAddDriver={()=>openAppModal('Fleetos Add Driver.html')} onItemClick={handleItemClick} />,
    profile:<ProfilePage user={user} />,
  };

  return(
    <div style={{background:BG,height:"100%",minHeight:0,display:"flex",flexDirection:"column",fontFamily:"'DM Sans',sans-serif",overflow:"hidden"}}>
      <AppHeader user={user} page={page} onNavigate={setPage} alertCount={data.alerts.length} />
      
      <div style={{flex:1,minHeight:0,overflowY:"auto"}} className="no-scrollbar">
        {pages[page]}
      </div>

      <BottomNav active={page} onChange={setPage} />

      {modalPage && <ModalPage {...modalPage} onClose={() => { setModalPage(null); fetchData(); }} />}

      {/* Fleet Map Modal */}
      {showMapModal && (
        <div style={{position:'fixed', inset:0, background:WH, zIndex:200000, display:'flex', flexDirection:'column'}}>
           <div style={{padding:20, background:G, color:WH, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div style={{fontFamily:"'Sora',sans-serif", fontWeight:800, fontSize:18}}>Live Fleet Map</div>
              <div onClick={() => setShowMapModal(false)} style={{fontSize:24, cursor:'pointer'}}>✕</div>
           </div>
           <div style={{flex:1, position:'relative', background:BG2, overflowY:'auto', minHeight:0}}>
                <div style={{position:'absolute', inset:0, background:`linear-gradient(135deg, ${GLt} 0%, ${BLLt} 100%)`, opacity:0.5}}></div>
                <div style={{padding:'20px 20px 120px', position:'relative', zIndex:1, minHeight:'100%'}}>
                   <div style={{fontSize:11, fontWeight:800, color:G, marginBottom:20}}>📍 {fleetLocations.length} DRIVERS ONLINE</div>
                   {selectedFleetLocation && (
                     <Card style={{padding:18, marginBottom:16, border:`1.5px solid ${selectedFleetLocation.location_alert ? CR : G}`}}>
                       <div style={{display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start', marginBottom:12}}>
                         <div>
                           <div style={{fontSize:18, fontWeight:900, color:INK}}>{selectedFleetLocation.full_name}</div>
                           <div style={{fontSize:11.5, color:MU, marginTop:4}}>
                             {selectedFleetLocation.assigned_truck || 'Truck not assigned'}{selectedFleetLocation.phone ? ` · ${selectedFleetLocation.phone}` : ''}
                           </div>
                         </div>
                         <Tag color={selectedFleetLocation.location_alert ? CR : G} bg={selectedFleetLocation.location_alert ? CRLt : GLt2}>
                           {selectedFleetLocation.location_alert ? 'Location Alert' : 'Live Tracking'}
                         </Tag>
                       </div>
                       <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12}}>
                         <div style={{background:BG, border:`1px solid ${BD}`, borderRadius:12, padding:12}}>
                           <div style={{fontSize:9, fontWeight:800, color:MU, textTransform:'uppercase', letterSpacing:1}}>Active Trip</div>
                           <div style={{fontSize:14, fontWeight:800, color:INK, marginTop:6}}>
                             {selectedFleetLocation.active_trip_id || 'No active trip'}
                           </div>
                           <div style={{fontSize:11, color:MU, marginTop:4}}>
                             {selectedFleetLocation.active_trip_origin && selectedFleetLocation.active_trip_destination
                               ? formatRouteLabel(selectedFleetLocation.active_trip_origin, selectedFleetLocation.active_trip_destination)
                               : 'Waiting for dispatch'}
                           </div>
                         </div>
                         <div style={{background:BG, border:`1px solid ${BD}`, borderRadius:12, padding:12}}>
                           <div style={{fontSize:9, fontWeight:800, color:MU, textTransform:'uppercase', letterSpacing:1}}>Last Known Location</div>
                           <div style={{fontSize:14, fontWeight:800, color:INK, marginTop:6}}>
                             {selectedFleetLocation.last_lat?.toFixed(4)}, {selectedFleetLocation.last_lng?.toFixed(4)}
                           </div>
                           <div style={{fontSize:11, color:MU, marginTop:4}}>
                             Updated {selectedFleetLocation.last_ping ? new Date(selectedFleetLocation.last_ping).toLocaleString() : 'just now'}
                           </div>
                         </div>
                       </div>
                       {selectedFleetLocation.location_alert && (
                         <div style={{background:CRLt, border:`1px solid ${CR}33`, borderRadius:12, padding:12, color:CR, fontSize:12, fontWeight:700, marginBottom:12}}>
                           {selectedFleetLocation.location_alert}
                         </div>
                       )}
                       <div style={{display:'flex', gap:10}}>
                       <button
                           onClick={() => selectedFleetLocation.last_lat != null && selectedFleetLocation.last_lng != null && window.open(`https://www.google.com/maps?q=${selectedFleetLocation.last_lat},${selectedFleetLocation.last_lng}`, '_blank')}
                           style={{flex:1, padding:'12px 14px', borderRadius:12, border:'none', background:G, color:WH, fontWeight:800, cursor:selectedFleetLocation.last_lat != null && selectedFleetLocation.last_lng != null ? 'pointer' : 'not-allowed', opacity:selectedFleetLocation.last_lat != null && selectedFleetLocation.last_lng != null ? 1 : 0.55}}
                         >
                           Open in Maps
                         </button>
                         <button
                           onClick={() => selectedFleetLocation.phone && (window.location.href = `tel:${selectedFleetLocation.phone}`)}
                           style={{flex:1, padding:'12px 14px', borderRadius:12, border:`1.5px solid ${BD}`, background:WH, color:INK, fontWeight:800, cursor:'pointer'}}
                         >
                           Call Driver
                         </button>
                       </div>
                     </Card>
                   )}
                   <div style={{display:'flex', flexDirection:'column', gap:10}}>
                      {fleetLocations.length > 0 ? fleetLocations.map(loc => (
                        <Card
                          key={loc.id}
                          onClick={() => setSelectedFleetLocation(loc)}
                          style={{padding:15, cursor:'pointer', border:`1.5px solid ${String(selectedFleetLocation?.id) === String(loc.id) ? (loc.location_alert ? CR : G) : BD}`}}
                        >
                           <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                              <div>
                                 <div style={{fontSize:14, fontWeight:800, color:INK}}>{loc.full_name}</div>
                                 <div style={{fontSize:11, color:MU}}>
                                   {(loc.active_trip_origin && loc.active_trip_destination)
                                     ? formatRouteLabel(loc.active_trip_origin, loc.active_trip_destination)
                                     : (loc.assigned_truck || 'Active Duty')}
                                 </div>
                                 <div style={{fontSize:10, color:MU2, marginTop:4}}>
                                   Lat: {loc.last_lat?.toFixed(4)}, Lng: {loc.last_lng?.toFixed(4)}
                                 </div>
                              </div>
                              <div style={{textAlign:'right'}}>
                                 <div style={{fontSize:9, fontWeight:800, color: loc.location_alert ? CR : G}}>{loc.location_alert ? '🚨 ALERT' : '🟢 ONLINE'}</div>
                                 <div style={{fontSize:9, color:MU2, marginTop:2}}>Updated: {loc.last_ping ? new Date(loc.last_ping).toLocaleTimeString() : 'Waiting'}</div>
                              </div>
                           </div>
                        </Card>
                      )) : (
                        <div style={{textAlign:'center', padding:40, color:MU}}>No drivers sharing location currently.</div>
                      )}
                   </div>
                </div>
           </div>
        </div>
      )}

      {activeAction.open && <ActionModal item={activeAction.item} type={activeAction.type} trips={data.trips} onClose={()=>setActiveAction({open:false,item:null,type:null})} onDeleteSuccess={handleDeleteSuccess} />}
      {tripModal.open && <TripDetailModal trip={tripModal.trip} type={tripModal.type} onClose={()=>setTripModal({open:false, trip:null, type:null})} onRefresh={fetchData} />}
    </div>
  );
}
