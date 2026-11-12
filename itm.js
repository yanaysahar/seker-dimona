// Conversion between WGS84 (GPS) and the Israeli Transverse Mercator grid
// (רשת ישראל החדשה, ITM, EPSG:2039).
// Datum shift: 7-parameter Helmert, EPSG transformation "Israel 1993 to WGS 84 (2)"
// (EPSG:1073, accuracy ~0.5 m — the default PROJ/pyproj choice for EPSG:2039).
// Projection: Transverse Mercator using the Krüger series (6th order).
(function (global) {
  'use strict';
  var D2R = Math.PI / 180, S2R = Math.PI / 648000;

  // GRS80 (Israel 1993 datum) and WGS84 ellipsoids
  var GRS80 = { a: 6378137, f: 1 / 298.257222101 };
  var WGS84 = { a: 6378137, f: 1 / 298.257223563 };

  // ITM projection parameters
  var LAT0 = 31.7343936111111 * D2R, LON0 = 35.2045169444444 * D2R;
  var K0 = 1.0000067, X0 = 219529.584, Y0 = 626907.39;

  // Israel 1993 -> WGS84 (coordinate-frame rotation convention)
  var TX = 23.772, TY = 17.49, TZ = 17.859;
  var RX = 0.3132 * S2R, RY = 1.85274 * S2R, RZ = -1.67299 * S2R, DS = -5.4262e-6;

  function toEcef(lat, lon, ell) {
    var e2 = ell.f * (2 - ell.f), s = Math.sin(lat);
    var N = ell.a / Math.sqrt(1 - e2 * s * s);
    return [N * Math.cos(lat) * Math.cos(lon), N * Math.cos(lat) * Math.sin(lon), N * (1 - e2) * s];
  }

  function fromEcef(X, Y, Z, ell) {
    var e2 = ell.f * (2 - ell.f), p = Math.sqrt(X * X + Y * Y);
    var lat = Math.atan2(Z, p * (1 - e2)), h = 0;
    for (var i = 0; i < 10; i++) {
      var s = Math.sin(lat), N = ell.a / Math.sqrt(1 - e2 * s * s);
      h = p / Math.cos(lat) - N;
      lat = Math.atan2(Z, p * (1 - e2 * N / (N + h)));
    }
    return [lat, Math.atan2(Y, X)];
  }

  // local (Israel 1993) ECEF -> WGS84 ECEF
  function helmert(v) {
    var x = v[0], y = v[1], z = v[2], m = 1 + DS;
    return [m * (x + RZ * y - RY * z) + TX, m * (-RZ * x + y + RX * z) + TY, m * (RY * x - RX * y + z) + TZ];
  }
  // WGS84 ECEF -> local ECEF (inverse of the above)
  function helmertInv(v) {
    var x = (v[0] - TX), y = (v[1] - TY), z = (v[2] - TZ), m = 1 + DS;
    // inverse rotation = transpose for small angles
    return [(x - RZ * y + RY * z) / m, (RZ * x + y - RX * z) / m, (-RY * x + RX * y + z) / m];
  }

  // Krüger series coefficients for GRS80
  var f = GRS80.f, n = f / (2 - f), e = Math.sqrt(f * (2 - f));
  var n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
  var A = GRS80.a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  var alpha = [0,
    n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
    13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
    61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
    49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
    34729 * n5 / 80640 - 3418889 * n6 / 1995840,
    212378941 * n6 / 319334400];
  var beta = [0,
    n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360 - 81 * n5 / 512 + 96199 * n6 / 604800,
    n2 / 48 + n3 / 15 - 437 * n4 / 1440 + 46 * n5 / 105 - 1118711 * n6 / 3870720,
    17 * n3 / 480 - 37 * n4 / 840 - 209 * n5 / 4480 + 5569 * n6 / 90720,
    4397 * n4 / 161280 - 11 * n5 / 504 - 830251 * n6 / 7257600,
    4583 * n5 / 161280 - 108847 * n6 / 3991680,
    20648693 * n6 / 638668800];

  function tmForward(lat, lon) {
    var dl = lon - LON0;
    var t = Math.sinh(Math.atanh(Math.sin(lat)) - e * Math.atanh(e * Math.sin(lat)));
    var xi1 = Math.atan2(t, Math.cos(dl));
    var eta1 = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
    var xi = xi1, eta = eta1;
    for (var j = 1; j <= 6; j++) {
      xi += alpha[j] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1);
      eta += alpha[j] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1);
    }
    return [K0 * A * eta, K0 * A * xi];
  }
  var NORTH0 = tmForward(LAT0, LON0)[1];

  function tmInverse(E, N) {
    var xi = (N - Y0 + NORTH0) / (K0 * A), eta = (E - X0) / (K0 * A);
    var xi1 = xi, eta1 = eta;
    for (var j = 1; j <= 6; j++) {
      xi1 -= beta[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      eta1 -= beta[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    var dl = Math.atan2(Math.sinh(eta1), Math.cos(xi1));
    var tp = Math.sin(xi1) / Math.sqrt(Math.sinh(eta1) * Math.sinh(eta1) + Math.cos(xi1) * Math.cos(xi1));
    var tau = tp, e2 = e * e;
    for (var i = 0; i < 10; i++) {
      var sig = Math.sinh(e * Math.atanh(e * tau / Math.sqrt(1 + tau * tau)));
      var tpi = tau * Math.sqrt(1 + sig * sig) - sig * Math.sqrt(1 + tau * tau);
      var d = (tp - tpi) / Math.sqrt(1 + tpi * tpi) * (1 + (1 - e2) * tau * tau) / ((1 - e2) * Math.sqrt(1 + tau * tau));
      tau += d;
      if (Math.abs(d) < 1e-14) break;
    }
    return [Math.atan(tau), LON0 + dl];
  }

  // GPS (WGS84 degrees) -> ITM {x, y} in metres
  function wgs84ToItm(lat, lon) {
    var loc = fromEcef.apply(null, helmertInv(toEcef(lat * D2R, lon * D2R, WGS84)).concat([GRS80]));
    var xy = tmForward(loc[0], loc[1]);
    return { x: X0 + xy[0], y: Y0 + xy[1] - NORTH0 };
  }

  // ITM {x, y} metres -> GPS (WGS84 degrees)
  function itmToWgs84(x, y) {
    var ll = tmInverse(x, y);
    var w = fromEcef.apply(null, helmert(toEcef(ll[0], ll[1], GRS80)).concat([WGS84]));
    return { lat: w[0] / D2R, lng: w[1] / D2R };
  }

  // Rough bounds of the grid over Israel and the surrounding area
  function looksLikeItm(x, y) { return x > 100000 && x < 300000 && y > 350000 && y < 820000; }

  global.ITM = { wgs84ToItm: wgs84ToItm, itmToWgs84: itmToWgs84, looksLikeItm: looksLikeItm };
})(typeof window !== 'undefined' ? window : globalThis);
