/* ==================================================================
 * Filter Profil Voucher untuk halaman Report Mikhmon
 * Menambahkan dropdown "Profil" + ringkasan total terjual & total harga.
 * Bekerja di sisi browser (tidak mengubah logika PHP Mikhmon).
 * ================================================================== */
(function () {
  "use strict";

  function textOf(el) {
    return ((el && el.textContent) || "").replace(/\s+/g, " ").trim();
  }

  function parseMoney(str) {
    var n = (str || "").replace(/[^0-9]/g, "");
    return n ? parseInt(n, 10) : 0;
  }

  function formatMoney(n) {
    return n.toLocaleString("id-ID");
  }

  function idxOf(cells, keywords) {
    for (var i = 0; i < cells.length; i++) {
      var t = textOf(cells[i]).toLowerCase();
      for (var k = 0; k < keywords.length; k++) {
        if (t === keywords[k] || t.indexOf(keywords[k]) >= 0) return i;
      }
    }
    return -1;
  }

  /* cari baris header (bisa di thead ATAU di tbody seperti report Mikhmon) */
  function findHeader(table) {
    var rows = [].slice.call(table.rows || []);
    for (var i = 0; i < rows.length; i++) {
      var cells = [].slice.call(rows[i].cells || []);
      if (cells.length < 3) continue;
      var pi = idxOf(cells, ["profile", "profil", "paket", "plan"]);
      if (pi < 0) continue;
      // pastikan baris ini benar-benar header (ada kolom lain khas header)
      var looksHeader =
        idxOf(cells, ["username", "user", "date", "tanggal", "time"]) >= 0;
      if (!looksHeader) continue;
      return { rowIndex: i, cells: cells, profileIdx: pi,
        priceIdx: idxOf(cells, ["price", "harga"]) };
    }
    return null;
  }

  function enhance(table) {
    if (table.getAttribute("data-najwa-filter") === "1") return;
    var h = findHeader(table);
    if (!h) return;
    var rows = [].slice.call(table.rows || []);
    var bodyRows = rows.slice(h.rowIndex + 1).filter(function (tr) {
      var c = tr.cells;
      if (!c || !c[h.profileIdx]) return false;
      var v = textOf(c[h.profileIdx]);
      return v.length > 0;
    });
    if (bodyRows.length === 0) return;
    table.setAttribute("data-najwa-filter", "1");

    var seen = {}, profiles = [];
    bodyRows.forEach(function (tr) {
      var v = textOf(tr.cells[h.profileIdx]);
      if (!seen[v]) { seen[v] = true; profiles.push(v); }
    });
    profiles.sort();

    var bar = document.createElement("div");
    bar.className = "najwa-filter-bar";
    bar.style.cssText =
      "display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:10px 0;" +
      "padding:10px 12px;border-radius:10px;background:rgba(127,127,127,.14);font-size:14px";

    var label = document.createElement("label");
    label.textContent = "Filter Profil Voucher:";
    label.style.cssText = "font-weight:600;margin:0";

    var select = document.createElement("select");
    select.className = "form-control";
    select.style.cssText = "min-width:180px;padding:5px 8px;border-radius:8px";
    var optAll = document.createElement("option");
    optAll.value = "__all__";
    optAll.textContent = "Semua profil";
    select.appendChild(optAll);
    profiles.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p; o.textContent = p;
      select.appendChild(o);
    });

    var summary = document.createElement("span");
    summary.style.cssText = "margin-left:auto;font-weight:700";

    bar.appendChild(label);
    bar.appendChild(select);
    bar.appendChild(summary);

    function apply() {
      var want = select.value, count = 0, sum = 0;
      bodyRows.forEach(function (tr) {
        var v = textOf(tr.cells[h.profileIdx]);
        var show = want === "__all__" || v === want;
        tr.style.display = show ? "" : "none";
        if (show) {
          count++;
          if (h.priceIdx >= 0 && tr.cells[h.priceIdx])
            sum += parseMoney(textOf(tr.cells[h.priceIdx]));
        }
      });
      summary.textContent = "Total terjual: " + count +
        (h.priceIdx >= 0 ? " | Total: Rp " + formatMoney(sum) : "");
    }

    select.addEventListener("change", apply);
    var host = table.closest(".table-responsive") || table;
    host.parentNode.insertBefore(bar, host);
    apply();
  }

  function run() {
    [].slice.call(document.querySelectorAll("table")).forEach(function (t) {
      try { enhance(t); } catch (e) {}
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else { run(); }

  var tries = 0;
  var timer = setInterval(function () {
    tries++; run();
    if (tries > 40) clearInterval(timer);
  }, 600);
  if (window.MutationObserver) {
    new MutationObserver(function () { run(); })
      .observe(document.documentElement, { childList: true, subtree: true });
  }
})();
