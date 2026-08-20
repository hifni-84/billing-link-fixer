/* ==================================================================
 * Filter Profil Voucher untuk halaman Report Mikhmon
 * Menambahkan dropdown "Profil" + ringkasan total terjual & total harga.
 * Bekerja di sisi browser (tidak mengubah logika PHP Mikhmon).
 * ================================================================== */
(function () {
  "use strict";

  function isReportPage() {
    var q = (location.search || "").toLowerCase();
    var body = (document.body && document.body.innerText || "").toLowerCase();
    return /id=(report|sales|log)/.test(q) || /report/.test(q) ||
      body.indexOf("total sales") >= 0 || body.indexOf("laporan") >= 0;
  }

  function textOf(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function findIndex(headCells, keywords) {
    for (var i = 0; i < headCells.length; i++) {
      var t = textOf(headCells[i]).toLowerCase();
      for (var k = 0; k < keywords.length; k++) {
        if (t.indexOf(keywords[k]) >= 0) return i;
      }
    }
    return -1;
  }

  function parseMoney(str) {
    var n = (str || "").replace(/[^0-9]/g, "");
    return n ? parseInt(n, 10) : 0;
  }

  function formatMoney(n) {
    return n.toLocaleString("id-ID");
  }

  function enhance(table) {
    if (table.getAttribute("data-najwa-filter") === "1") return;
    var headRow = table.querySelector("thead tr");
    if (!headRow) return;
    var headCells = headRow.querySelectorAll("th,td");
    var profileIdx = findIndex(headCells, ["profile", "profil", "paket", "plan"]);
    if (profileIdx < 0) return;
    var priceIdx = findIndex(headCells, ["price", "harga", "total"]);
    var bodyRows = [].slice.call(table.querySelectorAll("tbody tr"));
    if (bodyRows.length === 0) return;
    table.setAttribute("data-najwa-filter", "1");

    // kumpulkan daftar profil unik
    var seen = {};
    var profiles = [];
    bodyRows.forEach(function (tr) {
      var cells = tr.querySelectorAll("td,th");
      if (!cells[profileIdx]) return;
      var v = textOf(cells[profileIdx]);
      if (!v || seen[v]) return;
      seen[v] = true;
      profiles.push(v);
    });
    profiles.sort();
    if (profiles.length === 0) return;

    // bar filter
    var bar = document.createElement("div");
    bar.className = "najwa-filter-bar";
    bar.style.cssText =
      "display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:10px 0;" +
      "padding:10px 12px;border-radius:10px;background:rgba(127,127,127,.12);font-size:14px";

    var label = document.createElement("label");
    label.textContent = "Filter Profil Voucher:";
    label.style.cssText = "font-weight:600";

    var select = document.createElement("select");
    select.className = "form-control";
    select.style.cssText = "min-width:180px;padding:5px 8px;border-radius:8px";
    var optAll = document.createElement("option");
    optAll.value = "__all__";
    optAll.textContent = "Semua profil";
    select.appendChild(optAll);
    profiles.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p;
      o.textContent = p;
      select.appendChild(o);
    });

    var summary = document.createElement("span");
    summary.style.cssText = "margin-left:auto;font-weight:600";

    bar.appendChild(label);
    bar.appendChild(select);
    bar.appendChild(summary);

    function apply() {
      var want = select.value;
      var count = 0;
      var sum = 0;
      bodyRows.forEach(function (tr) {
        var cells = tr.querySelectorAll("td,th");
        if (!cells[profileIdx]) return;
        var v = textOf(cells[profileIdx]);
        var show = want === "__all__" || v === want;
        tr.style.display = show ? "" : "none";
        if (show) {
          count++;
          if (priceIdx >= 0 && cells[priceIdx]) sum += parseMoney(textOf(cells[priceIdx]));
        }
      });
      summary.textContent =
        "Total terjual: " + count + (priceIdx >= 0 ? " | Total: Rp " + formatMoney(sum) : "");
    }

    select.addEventListener("change", apply);
    var parent = table.parentNode;
    parent.insertBefore(bar, table);
    apply();
  }

  function run() {
    if (!isReportPage()) return;
    [].slice.call(document.querySelectorAll("table")).forEach(enhance);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
  // Mikhmon memuat sebagian tabel via ajax -> coba ulang beberapa kali
  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    run();
    if (tries > 20) clearInterval(timer);
  }, 700);
})();
